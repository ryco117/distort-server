"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var OutMessageSchema = new Schema({
  groupId: {
    type: mongoose.Schema.Type.ObjectId,
    ref: 'Groups',
    required: 'Must reference the existing group message was received on'
  },
  index: {
    type: Number,
    unique: true
  },
  lastStatusChange: {
    type: Date,
    default: Date.now
  },
  message: {
    type: String,
    required: 'Cannot save empty messages'
  },
  status: {
    type: String,
    enum: ['enqueued', 'cancelled', 'sent'],
    default: 'enqueued'
  },
  to: {
    type: String,
    required: 'Cannot save message without target'
  }
});

module.exports = mongoose.model('OutMessages', OutMessageSchema)