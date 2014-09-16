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
var view = nconf.get("view");
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
// work queue to add documents which are currently updated
var inWorkQueue = [];
// range of valid geohash values.
var validGeohashChar = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j', 'k', 'm', 'n', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
// variable to store the last insert document, to push it again after it is obsolete
var oldDoc;
// max repeations after a timeout
var maxTimeoutErrorRetries = 4;
// counter for error, because of timeout
var timeoutErrorCounter = 0;

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
        throw new Error(err);
    }
    
    console.log("Observer is running");
    // save pouchdb handle
    pouchdb = response;
   
    bucket = new couchbase.Connection(couchbaseConf, function(err) {
        if (err) {
            // Failed to make a connection to the Couchbase cluster.
            throw new Error(err);
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
                // querry failed
                throw new Error(err);
            }
            if (results.length > 0) {
                var doc = prepareResults(results);
                updateStatistic(doc);
            }
            console.log("Querry result with "+results.length+ " documents.");
            // set the query parameter for the next run
            setQueryParameter();
            // init the timeout to call the queryLoop later.
            queryTimer = setTimeout(queryLoop, view.settings.queryTimeout); 
        });
    }
    
    // set parameters for the view.
    var setQueryParameter = function () {
        // get the time now.
        var now = new Date();
        // set the actual time as the start key.
        view.opts.startkey = [[now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()]];
        // set the end key 1 minute later. Note that at the borders (from minute to minute, minute to hour, hour to hour, etc it is possible that not all data is available).
        view.opts.endkey = [[now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes() + 1]];
    }; 
    
    // prepare the result, which mean that we use run through the documents and do some summation
    var prepareResults = function (queryResult) {
        var doc = {};
        var now = new Date().toISOString();
        doc.date = now;
        doc.owner = user.email;
        doc.type = 'publishGeohash';
        doc._id = user.email + '/publishGeohash/' + now;
        doc.sum = queryResult.length;
        doc._rev = null;
        doc.boats = {};
        // add the channels values, to which we should map this document.
        doc.channels = view.channels;

        // run through all results
        for(var i = 0; i < queryResult.length; i++) {
            var geohash = queryResult[i].value.geohash;
            var boat = queryResult[i].key[queryResult[i].key.length - 1];
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
        
        console.log("Proccess : " + view.opts.startkey + " - " + view.opts.endkey);
        
        // update it now.
        pouchdb.put(doc, function(err, response) {
            if (err) {
                timeoutErrorCounter++;
                // repeat after a timeout, if not max repeats are reached.
                if (maxTimeoutErrorRetries > timeoutErrorCounter) {
                    console.log(err);
                    console.log("Retry after " + timeoutErrorCounter + " calls. "+err);
                    timer = setTimeout(sumulatePosition, timeout);
                    return;
                }
                // max retries reached.
                throw new Error(err);
            }
            if (0 !== timeoutErrorCounter) {
                console.log("Process is running ok again after " + timeoutErrorCounter + " retries. ");
                // no error occurred, so set counter back
                timeoutErrorCounter = 0;
            }

            if (oldDoc) {
                pouchdb.put(oldDoc, function(err, response) {
                    if (err) {
                        console.log("Error while updating obsolete document : "+err);
                    } else {
                        console.log("oldDoc is now obsolete!");
                    }
                });
            }
            
            // ok document successfully stored, store a reference to the document to update it after it is obsolete
            // it is obsolete when we push another document.
            oldDoc = doc;
            oldDoc.obsolete = true;
            oldDoc._rev = response.rev;
            
            // check if document is in in work queue and remove it
            var index = inWorkQueue.indexOf(doc._id);
            if (-1 !== index) {
                inWorkQueue.splice(index, 1);
            }
            
            // check if there was a _rev returned
            if (!response || !response.rev) {
                throw new Error("Got no rev after put");
            }
        });
        
    };
});
