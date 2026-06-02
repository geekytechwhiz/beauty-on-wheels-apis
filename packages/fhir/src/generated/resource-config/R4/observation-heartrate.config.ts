export default {

resource:'observation-heartrate',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/observation-heartrate'
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

file:'observation-heartrate.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.881Z',

source:'HL7-R4'

}

};
