export default {

resource:'SubstanceNucleicAcid',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/SubstanceNucleicAcid'
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

file:'SubstanceNucleicAcid.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.877Z',

source:'HL7-R4'

}

};
