"use strict";

var mongoose = require('mongoose'),
  distort_ipfs = require('../../distort-ipfs'),
  Account = mongoose.model('Accounts'),
  Group = mongoose.model('Groups'),
  InMessage = mongoose.model('InMessages'),
  OutMessage = mongoose.model('OutMessages');

const DEBUG = true;

// Ensure the correct Group-ID is shared across DB 
// and internal state for the active account
function checkUpdateActiveGroupId(peerId, groupId) {
  if(peerId !== distort_ipfs.peerId) {
    return;
  }
  
  Account.findOne({'peerId': peerId}, function(err, account) {
    distort_ipfs.activeGroupId = groupId;
  
    if(account.activeGroupId != groupId) {
      account.activeGroupId = groupId;
      account.save();
    }
  });
}

// List all (sub)group memberships through their groups and subgroup paths
exports.listGroups = function(req, res) {
  Group.find({accountId: req.headers.peerid})
    .select('name subgroupIndex height lastReadIndex')
    .exec(function(err, groups) {
    if(err) {
      return res.send(err);
    }
    res.json(groups);
  });
};

// Add topic and given subgroup path to account's groups
exports.addGroup = function(req, res) {
  const subI = parseInt(req.body.subgroupIndex);
  if(isNaN(subI) || subI < 0) {
    return res.send("subgroupIndex must be a non-negative integer");
  }
  
  var reqGroup = {};
  reqGroup.name = req.body.name;
  reqGroup.accountId = req.headers.peerid;
  Group.find(reqGroup, function(err, groups) {
    if(err) {
      return res.send(err);
    }
    if(groups.length > 0) {
      return res.send('This group is already subscribed to');
    }
    
    reqGroup.subgroupIndex = subI;
    try {
      distort_ipfs.subscribe(reqGroup.name, subI);
    } catch(err) {
      return res.send(err);
    }

    var newGroup = new Group(reqGroup);
    newGroup.save(function(err, group) {
      if(err) {
        return res.send(err);
      }
      res.json(group);
    });
  });
};

// Retrieve messages for the specified group
exports.readMissedMessages = function(req, res) {
  Group.findOne({name: req.params.groupName, accountId: req.headers.peerid}, function(err, group) {
    if(!group) {
      return res.send('Authorized account is not a member of group: ' + req.params.groupName);
    }
    
    InMessage
      .find({'groupId': group._id})
      .where('index').gt(group.lastReadIndex)
      .sort('-index')
      .select('cipher dateReceived from index message verified')
      .exec(function(err, inMsgs) {
      
      if(err) {
        return res.send(err);
      }
      OutMessage
        .find({'groupId': group._id})
        .where('index').gt(group.lastReadIndex)
        .sort('-index')
        .select('index lastStatusChange message status to')
        .exec(function(err, outMsgs) {
        
        if(err) {
          return res.send(err);
        }
        
        // Update last read message
        group.lastReadIndex = Math.max(inMsgs.length ? inMsgs[0].index : -1, outMsgs.length ? outMsgs[0].index : -1, group.lastReadIndex);
        group.save();
      
        res.json({'in': inMsgs, 'out': outMsgs});
      });
    });
  })
};

// Enqueue a message to the specified group
exports.postMessage = function(req, res) {
  Group.findOne({name: req.params.groupName, accountId: req.headers.peerid}, function(err, group) {
    if(!group) {
      return res.send('Authorized account is not a member of group: ' + req.params.groupName);
    }
    
    // If posting to this account and group soon, assume it to be the active group
    checkUpdateActiveGroupId(req.headers.peerid, group._id);
    
    var outMessage = new OutMessage({
      groupId: group._id,
      index: group.height++,
      message: req.body.message,
      to: req.body.to
    });
    outMessage.save(function(err, msg) {
      if(err) {
        return res.send(err);
      }
      if(DEBUG) {
        console.log('Saved enqueued message to DB at index: ' + msg.index);
      }
      
      group.save();
      res.json({message: 'Enqueued: ' + msg.message});
    });
  });
};

// Stop streaming on the specified group
exports.leaveGroup = function(req, res) {
  Group.find({'name': req.params.groupName, 'accountId': req.headers.peerid}, function(err, groups) {
    if(!groups.length) {
      return res.send('Authorized account is not a member of group: ' + req.params.groupName);
    }
    const group = groups[0];
    
    Group.remove({'name': req.params.groupName, 'accountId': req.headers.peerid}, function(err, delStats) {
      if(err) {
        return res.send(err);
      }

      try {
        distort_ipfs.unsubscribe(topic, group.subgroupIndex);
      } catch(err) {
        console.log(err);
      }
      res.json({message: 'Successfully left group: ' + req.params.groupName});
    });
  });
};
