var PouchDB = require('pouchdb');
var Worker = require('de.htwg.seapal.worker');
var nconf = require('nconf');

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
// get noView config
var noView = nconf.get("noView");
// reference to pouchdb handle
var pouchdb;
// timer which calls document creation cyclic
var timer = null;
// variable which will be set if we should exit
var exit = false;
// document which will be published
var publishGeohash = {};
publishGeohash.owner = user.email;
publishGeohash.type = 'publishGeohash';
publishGeohash._id = user.email + '/publishGeohash';
publishGeohash._rev = null;
publishGeohash.boats = {};
// a dict with all active boats.
var boats = {};

// handle the exit event
process.on('exit', function(code) {
    if (worker) {
        worker.close();
    }
});

// handle termination of program
process.on('SIGINT', function() {
    console.log('TripSimulator got SIGINT.');
    clearTimeout(timer);
    exit = true;
    process.exit(0);
});

// start new worker
var worker = new Worker(server, user, function(err, response) {
    if (err) {
        throw new Error(err);
    }
    
    console.log("Observer is running (press ctrl+c to end)");
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
                //console.log(doc);
                storeDocument(info.doc);
            }).on('complete', function (info) {
                console.log('complete');
            }).on('error', function (err) {
                console.log(err);
                process.exit(0);
            });
    });
    
    // store a document which was received by the changes feed
    var storeDocument = function (doc) {
        // we received a updated publishGeohash doc, set the new rev
        if (doc._id == publishGeohash._id) {
            publishGeohash._rev = doc._rev;
            return;
        }
        
        // if the document is no geoPosition document ignore it
        if (doc.type != "geoPosition") {
            return;
        }
        
        // if we where just notified that a document was removed, ignore it.
        if (doc._removed !== undefined) {
            return;
        }
        
        // if timer was not already started.
        if (null == timer) {
            // init the timeout to call the PublishSummaryDocument method later.
            timer = setTimeout(PublishSummaryDocument, noView.timeout * 1000); 
        }
        
        // add the document to the list of boats
        boats[doc.owner] = {geohash : doc.geohash, timestamp : new Date().getTime()};
    }
    
    // creates a summary document with all active users.
    var PublishSummaryDocument = function () {
        var now = new Date();
        var sec = now.getTime();
        publishGeohash.date = now.toISOString();
        // add the channels values, to which we should map this document.
        publishGeohash.channels = noView.channels;
        publishGeohash.boats = {};
        // get all boats which are not too old.
        for (var i in boats) {
            if (sec - boats[i].timestamp > (noView.validTime * 1000)) {
                delete boats[i]
            } else {
                publishGeohash.boats[i] = boats[i].geohash;
            }
        }
        
        publishGeohash.sum = publishGeohash.boats.length;
        
        
        // update it now.
        pouchdb.put(publishGeohash, function(err, response) {
            // set timer back
            clearTimeout(timer);
            timer = null;
            if (err) {
                console.log("Got error");
                console.log(err);
            } else {
                console.log(publishGeohash.date + " : Published Document!");
            }
        });
    }
   
});
