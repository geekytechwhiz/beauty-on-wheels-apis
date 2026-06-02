export default {

resource:'Observation-genetics',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/Observation-genetics'
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

file:'Observation-genetics.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.867Z',

source:'HL7-R4'

}

};
