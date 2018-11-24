"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var PeerSchema = new Schema({
  cert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Certs',
    required: 'Must include certificate with peer definition'
  },
  nickname: {
    type: String,
    unique: true
  }
});

module.exports = mongoose.model('Peers', PeerSchema);
