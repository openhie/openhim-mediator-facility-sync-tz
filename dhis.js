const winston = require('winston');
const request = require('request')
const utils = require('./utils')
const URI = require('urijs')
const async = require('async')
const isJSON = require('is-json')

module.exports = function (dhisconfig) {
  const config = dhisconfig
  return {
    getFacilities: function (orchestrations,callback) {
      var orgUnits = []
      var nexturl = new URI(config.url).segment('/dhis/api/organisationUnits')
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
              if(body.hasOwnProperty("organisationUnits")) {
                orgUnits.push(body.organisationUnits)                
                if(body.hasOwnProperty("pager") && body.pager.hasOwnProperty("nextPage"))
                  nexturl = body.pager.nextPage
                else
                  nexturl = false
              }
            }
            else {
              winston.error("Non JSON data returned by DHIS2 while getting organization Units")
              return callback(err,false)
            }
            orchestrations.push(utils.buildOrchestration('Fetching facilities from DHIS2', before, 'GET', nexturl.toString(), JSON.stringify(options.headers), res, body))
            return callback(err,nexturl)
          })
        },
        function() {
          if(nexturl)
          winston.info("Fetching In " + nexturl)
          return (nexturl!=false)
        },
        function() {
          return callback(orgUnits)
        }
      )
    },

    getOrgUnitDet: function (facId,orchestrations,callback) {
      var orgUnits = []
      var url = new URI(config.url).segment('/dhis/api/organisationUnits/' + facId)
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth
        }
      }
      let before = new Date()
      request.get(options, function (err, res, body) {
        orchestrations.push(utils.buildOrchestration('Fetching facilities from DHIS2', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,body)
      })
    }
  }
}
