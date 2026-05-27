export default {

resource:'Bundle',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/Bundle'
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

file:'Bundle.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.843Z',

source:'HL7-R4'

}

};
