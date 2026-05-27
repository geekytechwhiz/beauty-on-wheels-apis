export default {

resource:'CodeSystem',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/CodeSystem'
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

file:'CodeSystem.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.850Z',

source:'HL7-R4'

}

};
