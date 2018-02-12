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
const VIMS = require('./vims')
const DHIS = require('./dhis')
const HFR = require('./hfr')
const OIM = require('./openinfoman')
const Dom = require('xmldom').DOMParser

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
winston.add(winston.transports.Console, {level: 'info', timestamp: true, colorize: true})

//set environment variable so that the mediator can be registered
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp () {
  const app = express()

  function updateTransaction (req,body,statatusText,statusCode,orchestrations) {
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
        json:update
      }

      request.put(options, function(err, apiRes, body) {
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
    updateTransaction (req,"Still Processing","Processing","200","")
    var facilities = {}
    async.parallel([
      function(callback) {
        vims.lookup("facilities","paging=false",orchestrations,(err,body)=>{
          callback(err, body);
        })
      },
      function(callback) {
        vims.lookup("geographic-zones","",orchestrations,(err,body)=>{
        callback(err, body);
        })
      },
      function(callback) {
        vims.lookup("facility-types","",orchestrations,(err,body)=>{
        callback(err, body);
        })
      },
    ],
    function(err,results) {
      var facilities = results[0]
      var zones = results[1]
      var facilitytypes = results[2]
      if(err) {
        winston.error(err)
      }
      if(!isJSON(facilities) || !isJSON(zones) || !isJSON(facilitytypes)) {
        winston.error("VIMS has returned non JSON data,stop processing")
        return
      }
      facilities = JSON.parse(facilities)
      zones = JSON.parse(zones)
      facilitytypes = JSON.parse(facilitytypes)

      async.eachSeries(facilities.facilities,(facility,nextFacility)=>{
        vims.searchLookup(zones["geographic-zones"],facility.geographicZoneId,(zonename)=>{
          facility.zonename = zonename
          vims.searchLookup(facilitytypes["facility-types"],facility.typeId,(ftype)=>{
            facility.facilityType = ftype
            oim.addVIMSFacility(facility,orchestrations,(err,body)=>{
              winston.info("Processed " + facility.name)
              return nextFacility()
            })
          })
        })
      },function(){
        winston.info('Done Synchronizing VIMS Facilities!!!')
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    }
    )
  }),

  app.get('/syncDHIS2Facilities', (req, res) => {
    let orchestrations = []
    const dhis = DHIS(config.dhis)
    const oim = OIM(config.openinfoman)
    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")
    var processedParents = []
    dhis.getFacilities(orchestrations,(orgUnits)=>{
      async.eachSeries(orgUnits,(orgUnit,nxt)=>{
        const promises = []
        for(var k=0;k<orgUnit.length;k++) {
          promises.push(new Promise((resolve, reject) => {
            dhis.getOrgUnitDet(orgUnit[k].id,orchestrations,(err,orgUnitDet)=>{
              var orgUnitDet = JSON.parse(orgUnitDet)
              winston.info("Processing " + orgUnitDet.name)
              oim.addDHISFacility(orgUnitDet,orchestrations,(err, res,body,pid)=>{
                //add district
                if(pid && processedParents.indexOf(pid) == -1) {
                  processedParents.push(pid)
                  dhis.getOrgUnitDet(pid,orchestrations,(err,orgUnitDet)=>{
                    oim.addDHISOrg(JSON.parse(orgUnitDet),orchestrations,(err,res,body,pid)=>{
                      //add region
                      if(pid && processedParents.indexOf(pid) == -1) {
                        processedParents.push(pid)
                        dhis.getOrgUnitDet(pid,orchestrations,(err,orgUnitDet)=>{
                          oim.addDHISOrg(JSON.parse(orgUnitDet),orchestrations,(err,res,body,pid)=>{
                            //add country
                            if(pid && processedParents.indexOf(pid) == -1) {
                              processedParents.push(pid)
                              dhis.getOrgUnitDet(pid,orchestrations,(err,orgUnitDet)=>{
                                oim.addDHISOrg(JSON.parse(orgUnitDet),orchestrations,(err,res,body,pid)=>{
                                  resolve()
                                })
                              })
                            }
                            else
                              resolve()
                          })
                        })
                      }
                      else
                        resolve()
                    })
                  })
                }
                else
                  resolve()
              })
            })
          }))
        }

        Promise.all(promises).then(() => {
          return nxt()
        })

      },function(){
        winston.info("Done Sync DHIS2 Facilities")
        updateTransaction(req,"","Successful","200",orchestrations)
        orchestrations = []
      })
    })
  }),

  app.get('/syncHFROrgs', (req, res) => {
    let orchestrations = []
    const hfr = HFR(config.hfr)
    const oim = OIM(config.openinfoman)
    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")

    var loop_counter = {}
    function extract_orgs(org,parent) {
      loop_counter[parent] = org.length
      for(var k = 0;k<org.length;k++) {
        if("sub" in org[k]) {
          extract_orgs(org[k].sub,org[k].id)
        }
        loop_counter[parent]--
        if(loop_counter[parent] === 0)
        delete loop_counter[parent]
        orgs.push({"name":org[k].name,"id":org[k].id,"parent":parent})
      }

      if(!Object.keys(loop_counter).length) {
        oim.addHFROrgs(orgs,orchestrations,(err,res,body)=>{
          winston.info("Done Sync DHIS2 Facilities")
          updateTransaction(req,"","Successful","200",orchestrations)
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
      var orgs = extract_orgs(body.config.hierarchy,"Top")
    })

  }),

  app.get('/syncHFRFacilities', (req, res) => {
    let orchestrations = []
    const hfr = HFR(config.hfr)
    const oim = OIM(config.openinfoman)
    //transaction will take long time,send response and then go ahead processing
    res.end()
    updateTransaction (req,"Still Processing","Processing","200","")
    var nexturl = new URI(config.hfr.url).segment('/api/collections/409.json').addQuery('human', 'false')
    var username = config.hfr.username
    var password = config.hfr.password
    var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")

    const promises = []
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
              for(var k=0;k<body.sites.length;k++) {
                promises.push(new Promise((resolve, reject) => {
                  oim.addHFRFacility(body.sites[k],orchestrations,(err,res,body)=>{
                    resolve()
                  })
                }))
              }
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
        if(nexturl == false) {
          Promise.all(promises).then(() => {
            winston.info("Done Sync HFR Facilities")
            updateTransaction(req,"","Successful","200",orchestrations)
            orchestrations = []
          })
        }
        return (nexturl!=false)
      },
      function() {
        winston.info("Done fetching all url")
      }
    )

  })

  return app
}

/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start (callback) {
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
          const server = app.listen(9002, () => {
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
    const server = app.listen(9002, () => callback(server))
  }
}
exports.start = start

if (!module.parent) {
  // if this script is run directly, start the server
  start(() => winston.info('Listening on 9002...'))
}
