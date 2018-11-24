"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var InMessageSchema = new Schema({
  dateReceived: {
    type: Date,
    default: Date.now
  },
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Accounts',
    required: 'Cannot save message without source'
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Groups',
    required: 'Must reference the existing group message was received on'
  },
  index: {
    type: Number,
    unique: true,
    required: 'Must specify message index within group'
  },
  message: {
    type: String,
    required: 'Cannot save empty messages'
  },
  verified: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('InMessages', InMessageSchema)
