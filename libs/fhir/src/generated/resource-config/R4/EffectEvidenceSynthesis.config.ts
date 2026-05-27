export default {

resource:'EffectEvidenceSynthesis',

version:'R4',

profile:[
'http://hl7.org/fhir/StructureDefinition/EffectEvidenceSynthesis'
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

file:'EffectEvidenceSynthesis.mapping.json'

},

aliases:{},

references:[],

extensions:[],

transformers:[],

clientOverrides:true,

metadata:{

generated:true,

generatedAt:'2026-05-25T04:20:49.856Z',

source:'HL7-R4'

}

};
