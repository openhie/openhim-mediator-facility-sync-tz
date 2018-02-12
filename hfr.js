const winston = require('winston');
const request = require('request')
const utils = require('./utils')
const URI = require('urijs')
const async = require('async')
const isJSON = require('is-json')

module.exports = function (hfrconfig) {
  const config = hfrconfig
  return {
    getFacilities: function (orchestrations,callback) {
      var facilities = []
      var nexturl = new URI(config.url).segment('/api/collections/409.json').addQuery('human', 'false')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      async.doWhilst(
        function(callback) {
          var options = {
            url: nexturl.toString(),
            headers: {
              Authorization: auth
            }
          }
          let before = new Date()
          request.get(options, function (err, res, body) {
            if(isJSON(body)) {
              var body = JSON.parse(body)
              if(body.hasOwnProperty("sites")) {
                facilities.push(body.sites)
                if(body.hasOwnProperty("nextPage"))
                  nexturl = body.nextPage
                else
                  nexturl = false
              }
            }
            else {
              winston.error("Non JSON data returned by HFR while getting facilities")
              return callback(err,false)
            }
            orchestrations.push(utils.buildOrchestration('Fetching facilities from HFR', before, 'GET', nexturl.toString(), JSON.stringify(options.headers), res, body))
            return callback(err,nexturl)
          })
        },
        function() {
          if(nexturl)
          winston.info("Fetching In " + nexturl)
          return (nexturl!=false)
        },
        function() {
          return callback(facilities)
        }
      )
    }
  }
}
