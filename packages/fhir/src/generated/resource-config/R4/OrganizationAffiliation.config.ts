export default {

resource:'OrganizationAffiliation',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/OrganizationAffiliation'
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

file:'OrganizationAffiliation.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.868Z',

source:'HL7-R4'

}

};
