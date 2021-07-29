const mongoose = require('mongoose');

// the room id is autogenerated in mongodb
const roomSchema = mongoose.Schema({
    'ClientId' : {
        type: String,
        required: true
    },
    'TherapistId' : {
        type: String,
        required: true
    }
}, { timestamps: true });

const roomModel = mongoose.model('room', roomSchema);
module.exports = roomModel;