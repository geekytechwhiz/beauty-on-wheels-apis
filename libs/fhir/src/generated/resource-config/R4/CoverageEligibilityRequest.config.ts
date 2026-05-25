export default {

resource:'CoverageEligibilityRequest',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/CoverageEligibilityRequest'
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

file:'CoverageEligibilityRequest.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.853Z',

source:'HL7-R4'

}

};
