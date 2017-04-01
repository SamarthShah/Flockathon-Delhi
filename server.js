var flock = require('flockos');
var config = require('./config.js');
var express = require('express');
var fs = require('fs');
var firebase = require("firebase-admin");
const { Wit, log } = require('node-wit');
var Excel = require('exceljs');
var filename = "faqs.xlsx";
var serviceAccount = require("./firebase-key.json");
var https = require('https');

firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://helpie-ba7c9.firebaseio.com"
});

var database = firebase.database();

const client = new Wit({ accessToken: config.witToken });
client.message('Hi', {})
    .then((data) => {
        console.log('Yay, got Wit.ai response: ' + JSON.stringify(data));
    })
    .catch(console.error);

flock.appId = config.appId;
flock.appSecret = config.appSecret;

var app = express();

// Listen for events on /events, and verify event tokens using the token verifier.
app.use(flock.events.tokenVerifier);
app.post('/events', flock.events.listener);

// Read tokens from a local file, if possible.
var tokens;
try {
    tokens = require('./tokens.json');
} catch (e) {
    tokens = {};
}

// save tokens on app.install
flock.events.on('app.install', function (event, callback) {
    tokens[event.userId] = event.token;
    console.log(tokens);
    callback();
});

flock.events.on('client.slashCommand', function (event, callback) {
    console.log(event.text);
    var testtext = event.text;
    if (event.text != "samarth") {
        flock.chat.sendMessage(config.botToken, {
            to: event.userId,
            text: "Ram"
        });
        firebase.database().ref('chatData/').set({
            test: testtext
        });
        callback(null, { text: "Request Received" })
    } else {
        callback(null, { text: "Please provide more information" })
    }
});

// delete tokens on app.uninstall
flock.events.on('app.uninstall', function (event) {
    delete tokens[event.userId];
});

flock.events.on('client.messageAction', function (event, callback) {
    var messages = event.messages;
    console.log(messages);
    flock.chat.fetchMessages(tokens[event.userId], {
        chat: event.chat,
        uids: event.messageUids
    }, function (error, messages) {
        if (!error) {
            flock.chat.sendMessage(config.botToken, {
                to: event.userId,
                text: messages[0].text
            });
        }
        callback(null, { text: "Check message from bot" });
    }
    );


});

app.get('/list', function (req, res) {
    var event = JSON.parse(req.query.flockEvent);
    console.log(event);
    res.send("SideBar");
});

// Start the listener after reading the port from config
var port = config.port || 8080;
app.listen(port, function () {
    console.log('Listening on port: ' + port);
});

// exit handling -- save tokens in token.js before leaving
process.on('SIGINT', process.exit);
process.on('SIGTERM', process.exit);
process.on('exit', function () {
    fs.writeFileSync('./tokens.json', JSON.stringify(tokens));
});

// read from a file 
function exportXLSToDatabase() {
    var workbook = new Excel.Workbook();

    workbook.xlsx.readFile(filename)
        .then(function (data) {

            var worksheet = data.getWorksheet(1);
            worksheet.eachRow(function (row, rowNumber) {
                var _answerData = {}, _questionData = {};;
                // Iterate over all non-null cells in a row 
                row.eachCell(function (cell, colNumber) {
                    if (colNumber === 2) {
                        _answerData.key = cell.value;
                        _questionData.key = cell.value;
                    } else if (colNumber === 4) {
                        _answerData.answer = cell.value;
                    } else if (colNumber === 3) {
                        _questionData.question = cell.value;
                    }
                });

                if (rowNumber !== 1) {
                    //add answer to firebase
                    var _newPostKey = firebase.database().ref().child('answers').push().key,
                        _newAnswer = {};
                    _newAnswer['/answers/' + _newPostKey] = _answerData;
                    firebase.database().ref().update(_newAnswer);

                    //add data to wit 
                    exportQuestionsToWit(_questionData);
                }
            });

        });
}

//import Soties/questions 
function exportQuestionsToWit(data) {
    var requestData = {
        "id": data.key,
        "values": [{
            "value": data.question,
            "expressions": [data.question]
        }],
        "lookups" : ["trait"]
    };
    requestData=JSON.stringify(requestData);
    
    var options = {
        host: 'api.wit.ai',
        method: 'POST',
        path: '/entities',
        // authentication headers
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + config.witToken,
        }
    };
    //this is the call
    request = https.request(options, function (res) {
        var body = "";
        res.on('data', function (data) {
            body += data;
        });
        res.on('end', function () {
            //here we have the full response, html or json object
            console.log(JSON.parse(body));
        })
        res.on('error', function (e) {
            console.log("Got error: " + e.message);
        });
    });
    request.write(requestData);
    request.end();
}

//read and update database
if (config.exportXLS) {
    exportXLSToDatabase();
}