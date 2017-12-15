#!/usr/bin/env node
'use strict'

const winston = require('winston');
const medUtils = require('openhim-mediator-utils')
const express = require('express')
const request = require('request')
const isJSON = require('is-json')
const async = require('async')
const xpath = require('xpath')
const VIMS = require('./vims')
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

  app.get('/syncVIMS', (req, res) => {
    let orchestrations = []
    const vims = VIMS(config.vims)
    const oim = OIM(config.openinfoman)
    //transaction will take long time,send response and then go ahead processing
    //res.end()
    //updateTransaction (req,"Still Processing","Processing","200","")
    var facilities = {}
    vims.lookup("facilities","paging=false",orchestrations,(err,body)=>{
      global.facilities = body
      vims.lookup("geographic-zones","",orchestrations,(err,body)=>{
        global.zones = body
        vims.lookup("facility-types","",orchestrations,(err,body)=>{
          var facilitytypes = body
          if(err) {
            winston.error(err)
          }
          if(!isJSON(global.facilities) || !isJSON(global.zones) || !isJSON(facilitytypes)) {
            winston.error("VIMS has returned non JSON data,stop processing")
            return
          }
          facilities = JSON.parse(global.facilities)
          zones = JSON.parse(global.zones)
          facilitytypes = JSON.parse(facilitytypes)

          async.eachSeries(facilities.facilities,(facility,nextFacility)=>{
            vims.searchLookup(zones["geographic-zones"],facility.geographicZoneId,(zonename)=>{
              facility.zonename = zonename
              vims.searchLookup(facilitytypes["facility-types"],facility.typeId,(ftype)=>{
                facility.facilityType = ftype
                oim.addVIMSFacility(facility,(err,body)=>{
                  winston.info("Processed " + facility.name)
                  return nextFacility()
                })
              })
            })
          },function(){

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
