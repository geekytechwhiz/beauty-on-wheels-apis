export default {

resource:'SubstanceSpecification',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/SubstanceSpecification'
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

file:'SubstanceSpecification.mapping.json'

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
