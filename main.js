// initialize access to .env files for enviroment variables
require('dotenv').config();

// Initialize packages required for the server
const express = require('express');
const app = express();
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const fs = require('fs')

// Initializing server with http
const https = require('https');

// Reading the SSL certificates and appending it to the server
const options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
}

const server = https.createServer(options, app);

// Using socket Io for web sockets
const { Server } = require("socket.io");
const io = new Server(server);

// when you start working with socket this will be used to export the server socket to other controllers
module.exports = io;

const uri = process.env.DB_URI;
mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
    .then((result) => {

        const port = process.env.PORT || 3100; 
        console.log("Starting app...");

        console.log("Database Connection Successful.");

        server.listen(port);
        console.log(`App is now active at https://localhost:${port}`);

    })
    .catch((err) => {
        console.log(err);
    })

    
// set a template engine
app.set('view engine', 'ejs');

// set a middleware for handling cookies sent from request
app.use(cookieParser());

// set static files path
app.use(express.static('./assets',));

// these enables me to parse JSON documents sent to the server
app.use(express.json());

// adding authetication middlewares
const accountsManagementRoute = require('./controllers/auths/auth');

// using those middlewares, this is where that router functions come in all the code directed to /users/ will use the defined routes in the auth
app.use('/users', accountsManagementRoute);

// this opens up the admin/client/therapist specific routes so based on the logged in your i can push to either one
const adminController =  require('./controllers/admin_controller');
const clientController =  require('./controllers/client_controller');
const therapistController =  require('./controllers/therapist_controller');

// using them
app.use('/a', adminController); // a represents admin
app.use('/c', clientController); // c represents client
app.use('/t', therapistController); // t represents therapist

var mainController = require('./controllers/main_controller');
mainController(app);