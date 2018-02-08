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
        orchestrations.push(utils.buildOrchestration('Creating VIMS facility to openinfoman', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,body)
      })
    },

    addDHISFacility: function(orgUnitDet,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config.dhis_document)
        .segment('careServicesRequest/update/urn:openhie.org:openinfoman-tz:facility_create_dhis_tz')
      var username = config.username
      var password = config.password
      var pid = ""
      if(orgUnitDet.hasOwnProperty("parent") && orgUnitDet.parent.hasOwnProperty("id")) {
        pid = orgUnitDet.parent.id
      }
      var name = orgUnitDet.name.replace("&","&amp;")
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                      <csd:facility id="${orgUnitDet.id}">
                        <csd:hfr id="${orgUnitDet.code}"/>
                        <csd:name>${name}</csd:name>
                        <csd:parent id="${pid}"/>
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
        orchestrations.push(utils.buildOrchestration('Creating DHIS2 facility to openinfoman', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,res,body,pid)
      })
    },

    addDHISOrg: function(orgUnitDet,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config.dhis_document)
        .segment('careServicesRequest/update/urn:openhie.org:openinfoman-tz:organization_create_dhis_tz')
      var username = config.username
      var password = config.password
      var pid = ""
      if(orgUnitDet.hasOwnProperty("parent") && orgUnitDet.parent.hasOwnProperty("id")) {
        pid = orgUnitDet.parent.id
      }
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var name = orgUnitDet.name.replace("&","&amp;")
      var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                      <csd:organization id="${orgUnitDet.id}">
                        <csd:name>${name}</csd:name>
                        <csd:parent id="${pid}"/>
                      </csd:organization>
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
        orchestrations.push(utils.buildOrchestration('Creating DHIS2 Organization to openinfoman', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,res,body,pid)
      })
    }
  }
}
