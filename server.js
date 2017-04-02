var flock = require('flockos');
var config = require('./config.js');
var express = require('express');
var fs = require('fs');
var firebase = require("firebase-admin");
const { Wit, log } = require('node-wit');
var Excel = require('exceljs');
var filename = "public/temp/faqs.xlsx";
var serviceAccount = require("./firebase-key.json");
var https = require('https');
var http = require('http');
var _ = require("underscore");
var app = express();
var request = require('request');

firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://helpie-ba7c9.firebaseio.com"
});

var database = firebase.database();
var dbRef = database.ref();
var answerList;

dbRef.once("value").then(function (snapshot) {
    answerList = snapshot.val().answers;
});

const client = new Wit({ accessToken: config.witToken });


flock.appId = config.appId;
flock.appSecret = config.appSecret;

// Listen for events on /events, and verify event tokens using the token verifier.
app.use(express.static(config.publicDir));
app.use(express.static(config.nodeDir));

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
    flock.chat.sendMessage(config.botToken, {
        to: event.userId,
        text: "Thanks for installing Helpie. You can ask any helpdesk related questions. For example: What is paternity leave policy? Does public holiday counts weekends? What are development urls? What are developers contact details? What kind of methods available? How to send chatbot message? "
    });
    callback();
});

flock.events.on('client.slashCommand', function (event, callback) {
    console.log(event.text);
    var chatMessage = event.text;
    analyseReceivedMessage(chatMessage, event, callback, true);
});

flock.events.on('chat.receiveMessage', function (event, callback) {
    console.log(event.message.text);
    if (event.message.attachments) {

        var download = function (url, dest, cb) {
            var file = fs.createWriteStream(dest);
            var request = https.get(url, function (response) {
                response.pipe(file);
                file.on('finish', function () {
                    file.close(cb);  // close() is async, call cb after close completes.
                });
            }).on('error', function (err) { // Handle errors
                fs.unlink(dest); // Delete the file async. (But we don't check the result)
                if (cb) cb(err.message);
            });
        };

        download(event.message.attachments[0].downloads[0].src, "public/temp/faqs.xlsx", function () {
            exportXLSToDatabase();
            flock.chat.sendMessage(config.botToken, {
                to: event.userId,
                text: "Thanks. I have received your request for updating helpdesk database. It will get updated in few minutes. You should be able to interact with new set of questions/queries in 5 minutes."
            });
        });
    } else {
        analyseReceivedMessage(event.message.text, event, callback, false);
    }

});

function analyseReceivedMessage(chatMessage, event, callback, showQuestion) {

    client.message(chatMessage, {})
        .then((data) => {
            //console.log('Yay, got Wit.ai response: ' + JSON.stringify(data));
            //console.log(data.entities.intent);
            if (data.entities.intent) {
                //console.log(answerList);
                answers = (_.find(answerList, { key: data.entities.intent[0].value }));
                //console.log(answers.answer);
                if (showQuestion) {
                    botResponse = "Your Question: " + data._text + "\nResponse: " + answers.answer;
                }
                else {
                    botResponse = answers.answer;
                }
                flock.chat.sendMessage(config.botToken, {
                    to: event.userId,
                    text: botResponse
                });

            } else {
                var requestData = "{\"fields\": {\"project\": { \"key\": \"HELPIE\"},\"summary\": \"" + data._text + "\",\"description\": \"Flockathon - Creating an issue via REST API\",\"issuetype\": {\"name\": \"Bug\"}}}";
                // var requestData = '{"fields": {}}';
                // requestData=JSON.stringify(requestData)
                var options = {
                    host: 'helpie.atlassian.net',
                    port: 443,
                    method: 'POST',
                    path: '/rest/api/2/issue/',
                    // authentication headers
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + new Buffer('admin:Sapient@1234').toString('base64'),

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
                        ticketNumber = JSON.parse(body).id;
                        ticketKey = JSON.parse(body).key;
                        if (showQuestion) {
                            botResponse = "Your Question: " + data._text + "\nResponse: I'm sorry I didn't understand. I have forwarded your request to support team and request id is: " + ticketNumber + ". One of them will get in touch with you.";
                        }
                        else {
                            botResponse = "I'm sorry I didn't understand. I have forwarded your request to support team and request id is: " + ticketNumber + ". One of them will get in touch with you.";
                        }
                        flock.chat.sendMessage(config.botToken, {
                            to: event.userId,
                            text: botResponse
                        });
                        var newKey = firebase.database().ref().child(event.userId).push().key,
                            ticketData = {};
                        ticketData[event.userId + "/" + newKey] = { "request": data._text, "ticket_number": ticketNumber, "key": ticketKey };
                        firebase.database().ref().update(ticketData);
                    })
                    res.on('error', function (e) {
                        console.log("Got error: " + e.message);
                    });
                });
                request.write(requestData);
                request.end();
            }
            callback(null, { text: "Request Received" })
        })
        .catch(console.error);

}

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
            analyseReceivedMessage(messages[0].text, event, callback, true);
        }
        callback(null, { text: "Check message from bot" });
    }
    );


});

app.get('/list', function (req, res) {
    var event = JSON.parse(req.query.flockEvent);
    console.log(event);
    dbRef.once("value").then(function (snapshot) {
        ticketHistory = snapshot.val()[event.userId];
        sidebarData = ""
        for (var key in ticketHistory) {
            sidebarData += "<b><a href='https://helpie.atlassian.net/projects/HELPIE/issues/" + ticketHistory[key].key + "' target='_blank'>" + ticketHistory[key].ticket_number + "</a>:</b>" + ticketHistory[key].request + "</br>";
        }

        res.send(sidebarData);
    });

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
            //remove old data
            firebase.database().ref().child("answers").remove();
            var worksheet = data.getWorksheet(1),
                witData = [];
            worksheet.eachRow(function (row, rowNumber) {
                var _answerData = {}, _questionData = {};
                // Iterate over all non-null cells in a row 
                row.eachCell(function (cell, colNumber) {
                    if (colNumber === 2) {
                        _answerData.key = cell.value;
                        _questionData.value = cell.value;
                    } else if (colNumber === 4) {
                        _answerData.answer = cell.value;
                    } else if (colNumber === 3) {
                        var _questions = cell.value;
                        _questionData.expressions = _questions.split('\n');
                    }
                });

                if (rowNumber !== 1) {
                    //add answer to firebase
                    var _newPostKey = firebase.database().ref().child('answers').push().key,
                        _newAnswer = {};
                    _newAnswer['/answers/' + _newPostKey] = _answerData;
                    firebase.database().ref().update(_newAnswer);

                    witData.push(_questionData);
                }
            });

            //add data to wit 
            exportQuestionsToWit(witData);

        });
}

//import Soties/questions 
function exportQuestionsToWit(data) {
    var requestData = {
        "id": "intent",
        "values": data
    };
    requestData = JSON.stringify(requestData);

    var options = {
        host: 'api.wit.ai',
        method: 'PUT',
        path: '/entities/intent',
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