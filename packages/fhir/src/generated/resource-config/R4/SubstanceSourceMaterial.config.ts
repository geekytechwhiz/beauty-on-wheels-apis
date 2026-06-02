export default {

resource:'SubstanceSourceMaterial',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/SubstanceSourceMaterial'
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

file:'SubstanceSourceMaterial.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.878Z',

source:'HL7-R4'

}

};
