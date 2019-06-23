"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var SocialMediaLinkSchema = new Schema({
  cert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Certs',
    required: 'Must specify certificate that validated link'
  },
  handle: {
    type: String,
    required: 'Must be associated with a social media identity'
  },
  platform: {
    type: String,
    required: 'Must be associated with a social media platform'
  }
});

// Each pair (distort-peer,platform) must be unique. Thus, a peer can only link one identity per social media platform
SocialMediaLinkSchema.index({cert: 1, platform: 1}, {unique: true});

module.exports = mongoose.model('SocialMediaLinks', SocialMediaLinkSchema);
