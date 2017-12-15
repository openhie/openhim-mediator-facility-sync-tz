const winston = require('winston');
const request = require('request')
const utils = require('./utils')
const URI = require('urijs')
var https = require('https');
var http = require('http');

module.exports = function (oimconfig) {
  const config = oimconfig
  return {
    addVIMSFacility: function (facility,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config.vims_document)
        .segment('careServicesRequest')
        .segment('/update/urn:openhie.org:openinfoman-tz:facility_create_vims_tz')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                      <csd:facility id="` + facility.id + `">
                        <csd:code>` + facility.code + `</csd:code>
                        <csd:name>` + facility.name + `</csd:name>
                        <csd:district>` + facility.zonename + `</csd:district>
                        <csd:gln>` + facility.gln + `</csd:gln>
                        <csd:active>` + facility.active + `</csd:active>
                        <csd:ftype>` + facility.facilityType + `</csd:ftype>
                      </csd:facility>
    					       </csd:requestParams>`
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth,
          'Content-Type': 'text/xml'
           },
           body: csd_msg
      }

      let before = new Date()
      request.post(options, function (err, res, body) {
        return callback(err,body)
      })
    }
  }
}
