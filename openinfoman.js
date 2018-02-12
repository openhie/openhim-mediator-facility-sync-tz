const winston = require('winston');
const request = require('request')
const utils = require('./utils')
const URI = require('urijs')
const xpath = require('xpath')
const Dom = require('xmldom').DOMParser

module.exports = function (oimconfig) {
  const config = oimconfig
  function getHFRFacilityParent(admin_div,callback) {
    var url = new URI(config.url)
        .segment('/CSD/csr/')
        .segment(config.hfr_document)
        .segment('careServicesRequest')
        .segment('/urn:openhie.org:openinfoman-hwr:stored-function:organization_get_urns')
    var username = config.username
    var password = config.password
    var csd_msg = `<csd:requestParams xmlns:csd="urn:ihe:iti:csd:2013">
                    <csd:otherID assigningAuthorityName="http://hfrportal.ehealth.go.tz" code="code">${admin_div}</csd:otherID>
                   </csd:requestParams>`
    var auth = "Basic " + new Buffer(username + ":" + password).toString("base64")
    var options = {
      url: url.toString(),
      headers: {
        Authorization: auth,
        'Content-Type': 'text/xml'
      },
      body: csd_msg
    }

    request.post(options, (err, res, body) => {
      return callback(body)
    })
  }

  function getHFROrgParent(orgs,parent_id) {
    return orgs.find(org => {
      return org.id == parent_id
    })
  }

  return {
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
    },

    addHFRFacility: function(facility,orchestrations,callback) {
      getHFRFacilityParent(facility.properties.Admin_div,(parent)=>{
        const doc = new Dom().parseFromString(parent)
        const select = xpath.useNamespaces({'csd': 'urn:ihe:iti:csd:2013'})
        var parent_id = select('string(/csd:CSD/csd:organizationDirectory/csd:organization/@entityID)', doc)
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
        request.post(options, (err, res, body) => {
          winston.info("Added " + name)
          return callback(err,res,body)
        })
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

          request.post(options, (err, res, body) => {
            winston.info("Processed " + org_name)
          })
        }))
      })
    Promise.all(promises).then(() => {
      return callback(err,res,body)
    })
    },
  }
}
