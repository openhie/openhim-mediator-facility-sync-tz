const winston = require('winston');
const request = require('request')
const utils = require('./utils')
const URI = require('urijs')
const xpath = require('xpath')
const Dom = require('xmldom').DOMParser

module.exports = function (oimconfig) {
  const config = oimconfig
  function getHFROrgParent(orgs,parent_id) {
    return orgs.find(org => {
      return org.id == parent_id
    })
  }

  return {
    countEntities: function(entity_type,document,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config[document])
        .segment('careServicesRequest')
        .segment('/urn:ihe:iti:csd:2014:adhoc')
      var csd_msg = `<csd:requestParams xmlns:csd='urn:ihe:iti:csd:2013'>
                      <adhoc>declare namespace csd = 'urn:ihe:iti:csd:2013';count(/csd:CSD/csd:${entity_type}Directory/*)</adhoc>
                     </csd:requestParams>`
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
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
        orchestrations.push(utils.buildOrchestration('Counting entities', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,res,body)
      })
    },

    getFacilities: function (document,first_row,max_rows,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config[document])
        .segment('careServicesRequest')
        .segment('/urn:openhie.org:openinfoman-hwr:stored-function:facility_get_all')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd='urn:ihe:iti:csd:2013'>
                      <csd:start>${first_row}</csd:start>
                      <csd:max>${max_rows}</csd:max>
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
        orchestrations.push(utils.buildOrchestration('getting all facilities', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,res,body)
      })
    },

    searchByHFRCode: function (document,code,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config[document])
        .segment('careServicesRequest')
        .segment('/urn:openhie.org:openinfoman-hwr:stored-function:facility_get_all')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd='urn:ihe:iti:csd:2013'>
                      <csd:otherID assigningAuthorityName="http://hfrportal.ehealth.go.tz" code="Fac_IDNumber">${code}</csd:otherID>
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
        orchestrations.push(utils.buildOrchestration('getting all facilities', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,res,body)
      })
    },

    addVIMSFacility: function (facility,orchestrations,callback) {
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

    addDHISOrg: function(orgUnitDet,type,orchestrations,callback) {
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
                        <csd:type>${type}</csd:type>
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
    },

    addHFRFacility: function(facility,parent_id,orchestrations,callback) {
      var name = facility.name
      name = name.replace("&","&amp;")
      var id = facility.id
      var code = facility.properties.Fac_IDNumber
      var fac_type = facility.properties.Fac_Type
      var url = new URI(config.url)
                    .segment('/CSD/csr/')
                    .segment(config.hfr_document)
                    .segment('careServicesRequest')
                    .segment('/update/urn:openhie.org:openinfoman-tz:facility_create_hfr_tz')
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                      <csd:facility id="${id}" code="${code}">
                        <csd:parent id="${parent_id}" />
                        <csd:name>${name}</csd:name>
                        <csd:type>${fac_type}</csd:type>
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
      request.post(options, (err, res, body) => {
        winston.info("Added " + name)
        return callback(err,res,body)
      })
    },

    addHFROrgs: function(orgs,orchestrations,callback) {
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      const promises = []
      orgs.forEach(org=>{
        promises.push(new Promise((resolve, reject) => {
          var parent_id = org.parent
          var org_id =org.id
          var org_name = org.name
          org_name = org_name.replace("&","&amp;")
          if(parent_id != "Top") {
            var parent = getHFROrgParent(orgs,org.parent)
            var parent_name = parent.name
            parent_name = parent_name.replace("&","&amp;")
          }
          var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                          <csd:organization id="${org_id}">
                            <csd:name>${org_name}</csd:name>
                            <csd:parent id="${parent_id}" name="${parent_name}"/>
                          </csd:organization>
                        </csd:requestParams>`
          var url = new URI(config.url)
                      .segment('/CSD/csr/')
                      .segment(config.hfr_document)
                      .segment('careServicesRequest')
                      .segment('/update/urn:openhie.org:openinfoman-tz:organization_create_hfr_tz')
          var options = {
            url: url.toString(),
            headers: {
              Authorization: auth,
             'Content-Type': 'text/xml'
            },
            body: csd_msg
          }
          let before = new Date()
          request.post(options, (err, res, body) => {
            winston.info("Processed " + org_name)
          })
        }))
      })
      Promise.all(promises).then(() => {
        return callback(err,res,body)
      })
    },

    execReq: function(doc_name,csd_msg,urn,orchestrations,callback) {
      var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config[doc_name])
        .segment(`/careServicesRequest/${urn}`)
      var username = config.username
      var password = config.password
      var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
      var options = {
        url: url.toString(),
        headers: {
          Authorization: auth,
         'Content-Type': 'text/xml'
        },
        body: csd_msg
      }
      let before = new Date()
      request.post(options, (err, res, body) => {
        orchestrations.push(utils.buildOrchestration('Executing Req Against openinfoma', before, 'GET', url.toString(), JSON.stringify(options.headers), res, body))
        return callback(err,res,body)
      })
    }
  }
}
