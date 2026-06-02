export default {

resource:'CDS Hooks RequestGroup',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/CDS Hooks RequestGroup'
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

file:'CDS Hooks RequestGroup.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.844Z',

source:'HL7-R4'

}

};
