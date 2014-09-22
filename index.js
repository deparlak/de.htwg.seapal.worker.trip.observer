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
// max repeations after a timeout
var maxTimeoutErrorRetries = 4;
// counter for error, because of timeout
var timeoutErrorCounter = 0;
// document which will be published
var publishGeohash = {};
publishGeohash.owner = user.email;
publishGeohash.type = 'publishGeohash';
publishGeohash._id = user.email + '/publishGeohash';
publishGeohash._rev = null;

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
        
        // fetch the latest doc, which will be updated on new data
        pouchdb.get(publishGeohash._id, function(err, response) {
            // if we get an error, which is not because of a missing doc 
            // (missing doc is ok if it's the first created document by this user)
            if (err && err.status !== 404) {
                throw new Error(err);
            } else if (err && err.status === 404){
                publishGeohash._rev = null;
            } else {
                publishGeohash._rev = response._rev;
            }
            // query in a endless loop
            queryLoop();
        });
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
                prepareResults(results);
                updateStatistic();
            }
            console.log("Querry : " + view.opts.startkey + " - " + view.opts.endkey+" "+results.length+ " documents");
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
        view.opts.startkey = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()].concat(view.settings.channelStart);
        // set the end key 1 minute later. Note that at the borders (from minute to minute, minute to hour, hour to hour, etc it is possible that not all data is available).
        view.opts.endkey = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes() + 1].concat(view.settings.channelEnd);
    }; 
    
    // prepare the result, which mean that we use run through the documents and do some summation
    var prepareResults = function (queryResult) {
        var now = new Date().toISOString();
        publishGeohash.date = now;
        publishGeohash.sum = queryResult.length;
        publishGeohash.boats = {};
        // add the channels values, to which we should map this document.
        publishGeohash.channels = view.settings.channels;

        // run through all results
        for(var i = 0; i < queryResult.length; i++) {
            // key[0] - key[4] date in year,month,day,hour,minute
            // key[5] - key[13] geohash
            // key[14] user id
            var boat = queryResult[i].key[14];
            var geohash = "";
            for (var j = 5; j < 14; j++) {
                geohash += queryResult[i].key[j];
            }
            publishGeohash.boats[boat] = geohash;
        }
    }
    
    
    // update the statistic, by generating a document with the summarized value from the view
    var updateStatistic = function () {
        // update it now.
        pouchdb.put(publishGeohash, function(err, response) {
            if (err) {
                timeoutErrorCounter++;
                // repeat after a timeout, if not max repeats are reached.
                if (maxTimeoutErrorRetries > timeoutErrorCounter) {
                    console.log(err);
                    console.log("Retry after " + timeoutErrorCounter + " calls. "+err);
                    timer = setTimeout(updateStatistic, view.settings.queryTimeout);
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
            
            // check if there was a _rev returned
            if (!response || !response.rev) {
                throw new Error("Got no rev after put");
            }
            
            // store _rev
            publishGeohash._rev = response.rev;
        });
        
    };
});
