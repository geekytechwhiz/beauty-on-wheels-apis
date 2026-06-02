export default {

resource:'DiagnosticReport-Genetics',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/DiagnosticReport-Genetics'
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

file:'DiagnosticReport-Genetics.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.854Z',

source:'HL7-R4'

}

};
