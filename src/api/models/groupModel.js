"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var GroupSchema = new Schema({
  name: {
    type: String,
    required: 'Must give this group a name'
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Accounts',
    required: 'Must specify local account participating in this group'
  },
  subgroupIndex: {
    type: Number,
    required: 'Must be a Non-negative Integer'
  }
});

// Each pair of account and group must be unique. Thus a single account can only subscribe to a given group once
GroupSchema.index({owner:1, name: 1}, {unique: true});

module.exports = mongoose.model('Groups', GroupSchema);
