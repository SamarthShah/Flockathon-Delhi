var config = require('./config.js');
var express = require('express');
var fileUpload = require('express-fileupload');
var app = express();

// Listen for events on /events, and verify event tokens using the token verifier.
app.use(express.static(config.publicDir));
app.use(express.static(config.nodeDir));

// default options 
app.use(fileUpload());

//upload file 
app.post('/upload', function(req, res) {
  if (!req.files)
    return res.status(400).send('No files were uploaded.');
 
  // The name of the input field (i.e. "sampleFile") is used to retrieve the uploaded file 
  let excel = req.files.excel;
 
  // Use the mv() method to place the file somewhere on your server 
  excel.mv('public/download/faqs.xlsx', function(err) {
    if (err)
      return res.status(500).send(err);
 
    res.send('File uploaded!');
  });
});

// Start the listener after reading the port from config
app.listen(config.port, function () {
    console.log('Listening on port: ' + config.port);
});