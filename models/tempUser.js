const mongoose = require('mongoose');

const tempUserSchema = mongoose.Schema({
  'Email': {
    type: String,
    required: true
  },
  "Unique_Code": {
    type: String,
    required: true
  },
  'Expires_In': {
    type: Number,
    required: true
  }
}, { timestamps: true });

const tempUserModel = mongoose.model('tempUser', tempUserSchema);
module.exports = tempUserModel;