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
// get view config
var view = nconf.get("view");
// reference to pouchdb handle
var pouchdb;
// variable which will be set if we should exit
var exit = false;
// variable to check if rev is valid
var revOk = true;
// document which will be published
var publishGeohash = {};
publishGeohash.owner = user.email;
publishGeohash.type = 'publishGeohash';
publishGeohash._id = user.email + '/publishGeohash';
publishGeohash._rev = null;
publishGeohash.boats = {};

// handle the exit event
process.on('exit', function(code) {
    if (worker) {
        worker.close();
    }
});

// handle termination of program
process.on('SIGINT', function() {
    console.log('TripSimulator got SIGINT.');
    exit = true;
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
    
        pouchdb.changes({since : 'now', live : true, include_docs : true})
            .on('change', function (info) {
                if (exit) process.exit(0);
                storeDocument(info.doc);
            }).on('complete', function (info) {
                console.log('complete');
            }).on('error', function (err) {
                console.log(err);
                process.exit(0);
            });
    });


   
   
    var storeDocument = function (doc) {
        if (doc._id == publishGeohash._id) {
            revOk = true;
            publishGeohash._rev = doc._rev;
            return;
        }
        
        if (doc.type != "geoPosition") {
            return;
        }
        
        // else it is a geoPosition
        var now = new Date().toISOString();
        publishGeohash.date = now;
        // add the channels values, to which we should map this document.
        publishGeohash.channels = view.settings.channels;

        publishGeohash.boats[doc.owner] = doc.geohash;
        publishGeohash.sum = publishGeohash.boats.length;
        
        // check if rev is ok
        if (!revOk) return;
        revOk = false;
        
        // update it now.
        pouchdb.put(publishGeohash, function(err, response) {
            if (err) {
                console.log("Got error");
                console.log(err);
            }
        });
    }
   
});
