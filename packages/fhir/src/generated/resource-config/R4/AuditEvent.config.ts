export default {

resource:'AuditEvent',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/AuditEvent'
],

validation:{

enabled:true,

level:'BASIC',

requiredFields:[]

},

detection:{

enabled:false,

fields:[],

strategy:'ANY'

},

mapping:{

file:'AuditEvent.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.842Z',

source:'HL7-R4'

}

};
