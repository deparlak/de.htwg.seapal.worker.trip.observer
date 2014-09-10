var PouchDB = require('pouchdb');
var Worker = require('de.htwg.seapal.worker');
var nconf = require('nconf');
var couchbase = require('couchbase');

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
// get view config
var view = nconf.get("views")[0];
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
        // querry failed
        throw err;
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
        viewQuery = bucket.view(view.design, view.name);
        // set the query parameter
        setQueryParameter();
        // query in a endless loop
        queryLoop();
    });
    
    // query the view.
    var queryLoop = function () {
        clearTimeout(queryTimer);
        // execute query now
        viewQuery.query(view.opts, function(err, results) {
            if (err) {
                console.error(err);
                // querry failed
                throw err;
            }
            if (results.length > 0) {
                var doc = prepareResults(results);
                updateStatistic(doc);
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
        view.opts.startkey = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), view.opts.startkey];
        // set the actual time as the start key.
        view.opts.endkey = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), view.opts.endkey];
    }; 
    
    // prepare the result, which mean that we use run through the documents and do some summation
    var prepareResults = function (queryResult) {
        var doc = {};
        doc.owner = user.email;
        doc.startkey = view.opts.startkey;
        doc.endkey = view.opts.endkey;
        doc.type = 'publishGeohash';
        doc._id = 'publishGeohash/' + view.opts.startkey;
        doc.sum = queryResult.length;
        doc._rev = null;
        doc.boats = {};
        var now = new Date().toISOString();
        doc.date = now;

        // run through all results
        for(var i = 0; i < queryResult.length; i++) {
            geohash = queryResult[i].key[queryResult[i].key.length - 1];
            boat = queryResult[i].value;
            doc.boats[boat] = geohash;
        }
        return doc;
    }
    
    
    // update the statistic, by generating a document with the summarized value from the view
    var updateStatistic = function (doc) {        
        // if document is already in inWorkQueue, than do no update.
        if (-1 !== inWorkQueue.indexOf(doc._id)) {
            return;
        }
        // add document in inWorkQueue, to avoid multiple doc creations.
        inWorkQueue.push(doc._id);
        
        console.log(new Date().toISOString() + " : Documents in work queue : " + inWorkQueue.length);
        console.log("Proccess : " + view.opts.startkey + " - " + view.opts.endkey);
        
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
