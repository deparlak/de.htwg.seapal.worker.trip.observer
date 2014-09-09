var PouchDB = require('pouchdb');
var Worker = require('de.htwg.seapal.worker');
var nconf = require('nconf');
var couchbase = require('couchbase');

var config = { host :  [ "localhost:8091" ],
        bucket : "sync_gateway"
    };


//
// Setup nconf to use (in-order):
//   1. Command-line arguments
//   2. Environment variables
//   3. A file located at 'path/to/config.json'
//
nconf.argv()
   .env()
   .file({ file: 'config.json' });

// get server connection setup
var server = nconf.get("server");
// set user object
var user = nconf.get("user");
// get couchbase config
var couchbaseConf = nconf.get("couchbase");
// reference to pouchdb handle
var pouchdb;
// reference to couchbase
var bucket;
// reference to the view
var viewQuery;
// variable which will be set if we should exit
var exit = false;
// timer which calls query cyclic
var queryTimer;
// the timeout after which to execute the query again
var queryTimeout = 10000;
// work queue to add documents which are currently updated
var inWorkQueue = [];
// the maximum resolution of geohash values
var MAX_GEOHASH_RESOLUTION = 3;
// the possible max geohash resolution
var REAL_MAX_GEOHASH_RESOLUTION = 9;

var opts = {
        limit           :   10000,
        group           :   true,
        group_level     :   6,
        reduce          :   true,
        stale           :   "false"
    };
    
// handle the exit event
process.on('exit', function(code) {
    if (worker) {
        worker.close();
    }
});

// handle termination of program
process.on('SIGINT', function() {
    console.log('TripSimulator got SIGINT.');
    clearTimeout(queryTimer);
    process.exit(0);
});

// start new worker
var worker = new Worker(server, user, function(err, response) {
    if (err) {
        console.log(err);
        return;
    }
    
    console.log("Observer is running");
    // save pouchdb handle
    pouchdb = response;
   
    bucket = new couchbase.Connection(couchbaseConf, function(err) {
        if (err) {
            // Failed to make a connection to the Couchbase cluster.
            throw err;
        }
        
        // set the view which we like to get
        viewQuery = bucket.view('geohash', 'activeTrips');
        // set the query parameter
        setQueryParameter();
        // query in a endless loop
        queryLoop();
    });
    
    // query the view.
    var queryLoop = function () {
        clearTimeout(queryTimer);
        // execute query now
        viewQuery.query(opts, function(err, results) {
            console.log(results.length);
            var documents = prepareResults(results);
               
            for(i in documents) {
                updateStatistic(documents[i]);
            }
            
            // set the query parameter for the next run
            setQueryParameter();
            // init the timeout to call the queryLoop later.
            queryTimer = setTimeout(queryLoop, queryTimeout); 
        });
    }
    
    // set parameters for the view.
    var setQueryParameter = function () {
        // get the time now.
        var now = new Date();
        // set the actual time as the start key.
        opts.startkey = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()];
    }; 
    
    // prepare the result, which mean that we use run through the documents and do some summation
    var prepareResults = function (queryResult) {
        var docs = [];
        var sum = false;
        var index;
        var now = new Date().toISOString();
        // run through all results
        for(var i = 0; i < queryResult.length; i++) {
            // save the key of the queryResult
            key = queryResult[i].key;
            geohash = key[key.length - 1]; 
            // save the value of the queryResult
            value = queryResult[i].value;
            // is sum disabled
            if (!sum) {
                sum = true;
               // console.log("SUM "+geohash);
                // create a new doc
                var doc = {};
                doc.owner = user.email;
                doc.geohash = geohash;
                doc.type = 'publishGeohash';
                doc._id = 'publishGeohash/' + geohash;
                doc._rev = null;
                doc.count = value;
                tmpCount = value;
                childDepth = 0;
                doc.date = now;
                doc.child = [];
                // save index value
                index = i;
                // continue with next document
                continue;
            }
            // if it a child document
            if (geohash.length - 1 == doc.geohash.length || (geohash.length == REAL_MAX_GEOHASH_RESOLUTION && doc.geohash.length == MAX_GEOHASH_RESOLUTION)) {
                // sum is enabled, add, untill all child documents are added.
                // All child documents are added, when the sum of the child values is equal to the parent sum.
                tmpCount -= value;

                // store the geohash of the child to the document.
                doc.child.push(geohash);
                // all child docs added?
                if (0 == tmpCount) {
                    // set sum to false, to store next document with childs.
                    sum = false;
                    // push to all documents store.
                    docs.push(doc);
                    // if the childs added to this document where not the childs of the maximum geohash resolution
                    if (doc.geohash.length < MAX_GEOHASH_RESOLUTION) {
                        // set counter back, to check the index document, to count after this one.
                        i = index;
                    }
                }
            }
        }
        return docs;
    }
    
    
    // update the statistic, by generating a document with the summarized value from the view
    var updateStatistic = function (doc) {
         console.log("update statistic for : "+key + " : "  + value);
        // extract the hash, which is at last position after the date
        
        // if document is already in inWorkQueue, than do no update.
        if (-1 !== inWorkQueue.indexOf(doc._id)) {
            return;
        }
        // add document in inWorkQueue, to avoid multiple doc creations.
        inWorkQueue.push(doc._id);
        
        console.log(new Date().toISOString() + " : Documents in work queue : " + inWorkQueue.length);
        console.log("Proccess : "+geohash);
        
        // get the document and update it
        pouchdb.get(doc._id, function (err, response) {
            // check if the document could not be get. If we have a 404, no initial document existed yet
            if (err && err.status != 404) {
                throw new Error(err);
            }

            // check if there was a _rev returned
            if (response && response._rev) {
                doc._rev = response._rev;
            }
            
            // update it now.
            pouchdb.put(doc, function(err, response) {
                if (err) {
                    throw new Error(err);
                }
                
                // check if document is in in work queue and remove it
                var index = inWorkQueue.indexOf(doc._id);
                if (-1 !== index) {
                    inWorkQueue.splice(index, 1);
                }
                
                console.log(new Date().toISOString() + " : Documents in work queue : " + inWorkQueue.length);
                
                // check if there was a _rev returned
                if (!response || !response.rev) {
                    throw new Error("Got no rev after put");
                }
            });
        });
        
    };
});
