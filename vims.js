const winston = require('winston');
const request = require('request')
const utils = require('./utils')
const URI = require('urijs')
const async = require('async')
var https = require('https');
var http = require('http');

module.exports = function (vimsconfig) {
  const config = vimsconfig
  return {
    lookup: function (type,query,orchestrations,callback) {
      var url = new URI(config.url).segment('/rest-api/lookup/' + type)
      if(query)
      url = url + "?" + query
      var username = vimsconfig.username
      var password = vimsconfig.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64");
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }
      let before = new Date()
      request.get(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Fetching facilities from VIMS', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,body)
      })
    },

    searchLookup: function(lookupData,id,callback) {
      async.eachSeries(lookupData,(data,nextData)=>{
        if(id == data.id) {
          return callback(data.name)
        }
        else
        return nextData()
      },function(){
        return callback()
      })
    }
  }
}
