const mongoose = require('mongoose');

const clientSchema = mongoose.Schema({
    'First_Name' : {
        type: String,
        required: true
    },
    'Last_Name' : {
        type: String,
        required: true
    },
    'Email' : {
        type: String,
        required: true
    },
    'Telephone' : {
        type: String,
        required: true
    },
    'Password' : {
        type: String,
        required: true
    },
    'Date_of_Birth' : {
        type: String,
        required: true
    },
    'Unique_Code' : {
        type: String,
        required: true
    },
}, { timestamps: true });

const client = mongoose.model('client', clientSchema); // table initializatiion, the name of the table will be clients

module.exports = client;