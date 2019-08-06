#!/usr/bin/env node

'use strict'

const winston = require('winston');
const medUtils = require('openhim-mediator-utils')
const express = require('express')
const request = require('request')
const isJSON = require('is-json')
const URI = require('urijs')
const utils = require('./utils')
const async = require('async')
const xpath = require('xpath')
const XmlReader = require('xml-reader')
const xmlQuery = require('xml-query')
const VIMS = require('./vims')
const DHIS = require('./dhis')
const HFR = require('./hfr')
const OIM = require('./openinfoman')
const Dom = require('xmldom').DOMParser
var xml2json = require('xml2json');

const port = 9003
// Config
var config = {} // this will vary depending on whats set in openhim-core
const apiConf = require('./config/config')
const mediatorConfig = require('./config/mediator')

// socket config - large documents can cause machine to max files open
const https = require('https')
const http = require('http')

https.globalAgent.maxSockets = 32
http.globalAgent.maxSockets = 32

// Logging setup
winston.remove(winston.transports.Console)
winston.add(winston.transports.Console, {
  level: 'info',
  timestamp: true,
  colorize: true
})

//set environment variable so that the mediator can be registered
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp() {
  const app = express()

  function updateTransaction(req, body, statatusText, statusCode, orchestrations) {
    const transactionId = req.headers['x-openhim-transactionid']
    var update = {
      'x-mediator-urn': mediatorConfig.urn,
      status: statatusText,
      response: {
        status: statusCode,
        timestamp: new Date(),
        body: body
      },
      orchestrations: orchestrations
    }
    medUtils.authenticate(apiConf.api, function (err) {
      if (err) {
        return winston.error(err.stack);
      }
      var headers = medUtils.genAuthHeaders(apiConf.api)
      var options = {
        url: apiConf.api.apiURL + '/transactions/' + transactionId,
        headers: headers,
        json: update
      }

      request.put(options, function (err, apiRes, body) {
        if (err) {
          return winston.error(err);
        }
        if (apiRes.statusCode !== 200) {
          return winston.error(new Error('Unable to save updated transaction to OpenHIM-core, received status code ' + apiRes.statusCode + ' with body ' + body).stack);
        }
        winston.info('Successfully updated transaction with id ' + transactionId);
      });
    })
  }

  app.get('/syncVIMSFacilities', (req, res) => {
    let orchestrations = []
    const vims = VIMS(config.vims)
    const oim = OIM(config.openinfoman)
    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction(req, "Still Processing", "Processing", "200", "")
    var facilities = {}
    async.parallel([
        function (callback) {
          vims.lookup("facilities", "paging=false", orchestrations, (err, body) => {
            callback(err, body);
          })
        },
        function (callback) {
          vims.lookup("geographic-zones", "", orchestrations, (err, body) => {
            callback(err, body);
          })
        },
        function (callback) {
          vims.lookup("facility-types", "", orchestrations, (err, body) => {
            callback(err, body);
          })
        },
      ],
      function (err, results) {
        var facilities = results[0]
        var zones = results[1]
        var facilitytypes = results[2]
        if (err) {
          winston.error(err)
        }
        if (!isJSON(facilities) || !isJSON(zones) || !isJSON(facilitytypes)) {
          winston.error("VIMS has returned non JSON data,stop processing")
          return
        }
        facilities = JSON.parse(facilities)
        zones = JSON.parse(zones)
        facilitytypes = JSON.parse(facilitytypes)

        async.eachSeries(facilities.facilities, (facility, nextFacility) => {
          vims.searchLookup(zones["geographic-zones"], facility.geographicZoneId, (zonename) => {
            facility.zonename = zonename
            vims.searchLookup(facilitytypes["facility-types"], facility.typeId, (ftype) => {
              facility.facilityType = ftype
              oim.addVIMSFacility(facility, orchestrations, (err, body) => {
                winston.info("Processed " + facility.name)
                return nextFacility()
              })
            })
          })
        }, function () {
          winston.info('Done Synchronizing VIMS Facilities!!!')
          updateTransaction(req, "", "Successful", "200", orchestrations)
          orchestrations = []
        })
      }
    )
  })

  app.get('/syncDHIS2Facilities', (req, res) => {
    let orchestrations = []
    const dhis = DHIS(config.dhis)
    const oim = OIM(config.openinfoman)
    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction(req, "Still Processing", "Processing", "200", "")
    var processedParents = []
    dhis.getFacilities(orchestrations, (orgUnits) => {
      async.each(orgUnits, (orgUnit, nxtOrg) => {
        dhis.getOrgUnitDet(orgUnit.id, orchestrations, (err, orgUnitDet) => {
          if (isJSON(orgUnitDet)) {
            orgUnitDet = JSON.parse(orgUnitDet)
          } else {
            return nxtOrg()
          }
          var path = orgUnitDet.path.split("/")
          if (path.length < 5) {
            return nxtOrg()
          }
          winston.info("Processing " + orgUnitDet.name)
          oim.addDHISFacility(orgUnitDet, orchestrations, (err, res, body, pid) => {
            //add district
            if (pid && processedParents.indexOf(pid) == -1) {
              processedParents.push(pid)
              dhis.getOrgUnitDet(pid, orchestrations, (err, orgUnitDet) => {
                oim.addDHISOrg(JSON.parse(orgUnitDet), "district", orchestrations, (err, res, body, pid) => {
                  //add region
                  if (pid && processedParents.indexOf(pid) == -1) {
                    processedParents.push(pid)
                    dhis.getOrgUnitDet(pid, orchestrations, (err, orgUnitDet) => {
                      oim.addDHISOrg(JSON.parse(orgUnitDet), "region", orchestrations, (err, res, body, pid) => {
                        //add country
                        if (pid && processedParents.indexOf(pid) == -1) {
                          processedParents.push(pid)
                          dhis.getOrgUnitDet(pid, orchestrations, (err, orgUnitDet) => {
                            oim.addDHISOrg(JSON.parse(orgUnitDet), "country", orchestrations, (err, res, body, pid) => {
                              return nxtOrg()
                            })
                          })
                        } else {
                          return nxtOrg()
                        }
                      })
                    })
                  } else {
                    return nxtOrg()
                  }
                })
              })
            } else
              return nxtOrg()
          })
        })
      }, function () {
        winston.info("Done Sync DHIS2 Facilities")
        updateTransaction(req, "", "Successful", "200", orchestrations)
        orchestrations = []
      })
    })
  })

  app.get('/syncHFROrgs', (req, res) => {
    let orchestrations = []
    const hfr = HFR(config.hfr)
    const oim = OIM(config.openinfoman)
    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction(req, "Still Processing", "Processing", "200", "")

    var loop_counter = {}
    var orgs = []

    function extract_orgs(org, parent) {
      loop_counter[parent] = org.length
      for (var k = 0; k < org.length; k++) {
        if ("sub" in org[k]) {
          extract_orgs(org[k].sub, org[k].id)
        }
        loop_counter[parent]--
        if (loop_counter[parent] === 0)
          delete loop_counter[parent]
        orgs.push({
          "name": org[k].name,
          "id": org[k].id,
          "parent": parent
        })
      }

      if (!Object.keys(loop_counter).length) {
        oim.addHFROrgs(orgs, orchestrations, (err, res, body) => {
          winston.info("Done Sync DHIS2 Facilities")
          updateTransaction(req, "", "Successful", "200", orchestrations)
          orchestrations = []
        })
      }
    }

    var url = new URI(config.hfr.url).segment('/en/collections/409/fields/1629')
    var username = config.hfr.username
    var password = config.hfr.password
    var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")

    var options = {
      url: url.toString(),
      headers: {
        Authorization: auth
      }
    }

    request.get(options, (err, res, body) => {
      if (err) {
        return callback(err)
      }
      var body = JSON.parse(body)
      var orgs = extract_orgs(body.config.hierarchy, "Top")
    })

  })

  app.get('/syncHFRFacilities', (req, res) => {
    let orchestrations = []
    const hfr = HFR(config.hfr)
    const oim = OIM(config.openinfoman)
    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction(req, "Still Processing", "Processing", "200", "")

    function getVillages(callback) {
      oim.countEntities("organization", "hfr_document", orchestrations, (err, res, total) => {
        var firstRow = 1
        var maxRows = 500
        const promises = []
        var villages = {}
        for (var lastRow = maxRows; lastRow <= total; firstRow = lastRow + 1, lastRow = lastRow + maxRows) {
          var diff = total - lastRow
          if (diff < maxRows)
            lastRow = total
          promises.push(new Promise((resolve, reject) => {
            var csd_msg = `<csd:requestParams xmlns:csd='urn:ihe:iti:csd:2013'>
                            <csd:start>${firstRow}</csd:start>
                            <csd:max>${maxRows}</csd:max>
                          </csd:requestParams>`
            var urn = "urn:openhie.org:openinfoman-hwr:stored-function:organization_get_all"
            oim.execReq("hfr_document", csd_msg, urn, orchestrations, (err, res, body) => {
              var ast = XmlReader.parseSync(body);
              var totalOrg = xmlQuery(ast).find("organizationDirectory").children().size()
              var loopCntr = totalOrg
              var organizationDirectory = xmlQuery(ast).find("organizationDirectory").children()
              var orgIndexes = Array.from({
                length: totalOrg
              }, (x, i) => i)
              async.eachSeries(orgIndexes, (counter, nxtIndex) => {
                var entityID = organizationDirectory.eq(counter).attr("entityID")
                var orgDetails = organizationDirectory.eq(counter).children()
                var totalDetails = organizationDirectory.eq(counter).children().size()
                var detailsLoopControl = totalDetails
                for (var detailsCount = 0; detailsCount < totalDetails; detailsCount++) {
                  if (orgDetails.eq(detailsCount).attr("assigningAuthorityName") == "http://hfrportal.ehealth.go.tz" &&
                    orgDetails.eq(detailsCount).attr("code") == "code"
                  ) {
                    var admin_div = orgDetails.eq(detailsCount).text()
                    villages[admin_div] = entityID
                    nxtIndex()
                    break
                  }
                  nxtIndex()
                }
              }, function () {
                return resolve()
              })
            })
          }))
        }

        Promise.all(promises).then(() => {
          return callback(villages)
        })
      })
    }

    getVillages((villages) => {
      var nexturl = new URI(config.hfr.url).segment('/api/collections/409.json').addQuery('human', 'false')
      var username = config.hfr.username
      var password = config.hfr.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      const promises = []
      async.doWhilst(
        function (callback) {
          var options = {
            url: nexturl.toString(),
            headers: {
              Authorization: auth
            }
          }
          let before = new Date()
          request.get(options, function (err, res, body) {
            if (isJSON(body)) {
              var body = JSON.parse(body)
              if (body.hasOwnProperty("sites")) {
                for (var k = 0; k < body.sites.length; k++) {
                  promises.push(new Promise((resolve, reject) => {
                    var admin_div = body.sites[k].properties.Admin_div
                    var parent_id
                    if (villages.hasOwnProperty(admin_div)) {
                      parent_id = villages[admin_div]
                    }
                    oim.addHFRFacility(body.sites[k], parent_id, orchestrations, (err, res, body) => {
                      resolve()
                    })
                  }))
                }
                if (body.hasOwnProperty("nextPage"))
                  nexturl = body.nextPage
                else
                  nexturl = false
              }
            } else {
              winston.error("Non JSON data returned by HFR while getting facilities")
              return callback(err, false)
            }
            orchestrations.push(utils.buildOrchestration('Fetching facilities from HFR', before, 'GET', nexturl.toString(), JSON.stringify(options.headers), res, body))
            return callback(err, nexturl)
          })
        },
        function () {
          if (nexturl)
            winston.info("Fetching In " + nexturl)
          if (nexturl == false) {
            Promise.all(promises).then(() => {
              winston.info("Done Sync HFR Facilities")
              updateTransaction(req, "", "Successful", "200", orchestrations)
              orchestrations = []
            })
          }
          return (nexturl != false)
        },
        function () {
          winston.info("Done fetching all url")
        }
      )
    })
  })

  app.get('/autoMapDHIS-HFR', (req, res) => {
    const oim = OIM(config.openinfoman)
    let orchestrations = []
    oim.getFacilities("dhis_document", '', '', orchestrations, (err, res, body) => {
      var ast = XmlReader.parseSync(body)
      var totalFac = xmlQuery(ast).find("facilityDirectory").children().size()
      var facilityDirectory = xmlQuery(ast).find("facilityDirectory").children()
      let totalLoops = Array.from(new Array(totalFac), (val, index) => index);
      async.eachSeries(totalLoops, (counter, nxtLoop) => {
        var facilityDetails = facilityDirectory.eq(counter).children()
        var totalDetails = facilityDirectory.eq(counter).children().size()
        let results = {}
        for (var detailsCount = 0; detailsCount < totalDetails; detailsCount++) {
          if (facilityDetails.eq(detailsCount).attr("assigningAuthorityName") == "http://hfrportal.ehealth.go.tz" &&
            facilityDetails.eq(detailsCount).attr("code") == "code"
          ) {
            results.hfrcode = facilityDetails.eq(detailsCount).text()
          }
          if (facilityDetails.eq(detailsCount).attr("assigningAuthorityName") == "tanzania-hmis" &&
            facilityDetails.eq(detailsCount).attr("code") == "dhisid"
          ) {
            results.dhisid = facilityDetails.eq(detailsCount).text()
          }
        }

        if (!results.hasOwnProperty("hfrcode") || !results.hasOwnProperty("dhisid")) {
          return nxtLoop()
        }
        if (results.hfrcode == "" || results.hfrcode == "undefined") {
          return nxtLoop()
        }
        oim.searchByHFRCode("hfr_document", results.hfrcode, orchestrations, (err, res, body) => {
          var json = xml2json.toJson(body)
          json = JSON.parse(json)
          if (!json.CSD.facilityDirectory.hasOwnProperty("csd:facility")) {
            winston.warn(counter + 1 + "/" + totalFac + " DHIS2 facility with code " + results.hfrcode + " is not in HFR")
            return nxtLoop()
          }
          let otherIDs = json.CSD.facilityDirectory["csd:facility"]["csd:otherID"]
          //let otherIDsNoNamespace = json.CSD.facilityDirectory["csd:facility"]["otherID"]
          if (json.CSD.facilityDirectory["csd:facility"]["otherID"]) {
            otherIDs = otherIDs.concat(json.CSD.facilityDirectory["csd:facility"]["otherID"])
          }
          var mapped = false
          async.eachSeries(otherIDs, (otherid, nxtid) => {
            if (otherid.code == "id" && otherid.assigningAuthorityName == "tanzania-hmis")
              mapped = true
            return nxtid()
          }, function () {
            let target_id = json.CSD.facilityDirectory["csd:facility"]["entityID"]
            let source_id = results.dhisid
            if (mapped) {
              winston.info(counter + 1 + "/" + totalFac + target_id + " Already mapped with " + source_id)
              return nxtLoop()
            } else {
              var csd_msg = `<csd:requestParams xmlns:csd='urn:ihe:iti:csd:2013'>
                                    <csd:id entityID='${target_id}'/>
                                    <csd:otherID assigningAuthorityName='tanzania-hmis' code='id'>${source_id}</csd:otherID>
                                  </csd:requestParams>`
              var urn = "urn:openhie.org:openinfoman-hwr:stored-function:facility_create_otherid"
              winston.info(counter + 1 + "/" + totalFac + " Mapping HFR " + target_id + ' With ' + source_id)
              oim.execReq("hfr_document", csd_msg, urn, orchestrations, (err, res, body) => {
                return nxtLoop()
              })
            }
          })

        })

      })
    })
  })

  return app
}

/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start(callback) {
  if (apiConf.register) {
    medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
      if (err) {
        winston.error('Failed to register this mediator, check your config')
        winston.error(err.stack)
        process.exit(1)
      }
      apiConf.api.urn = mediatorConfig.urn
      medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
        winston.info('Received initial config:', newConfig)
        config = newConfig
        if (err) {
          winston.info('Failed to fetch initial config')
          winston.info(err.stack)
          process.exit(1)
        } else {
          winston.info('Successfully registered mediator!')
          let app = setupApp()
          const server = app.listen(port, () => {
            let configEmitter = medUtils.activateHeartbeat(apiConf.api)
            configEmitter.on('config', (newConfig) => {
              winston.info('Received updated config:', newConfig)
              // set new config for mediator
              config = newConfig
            })
            callback(server)
          })
        }
      })
    })
  } else {
    // default to config from mediator registration
    config = mediatorConfig.config
    let app = setupApp()
    const server = app.listen(port, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info('Listening on ' + port + '...'))
}