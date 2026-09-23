const {buildCsvFeed}=require('./src/prom-csv');
const suppliers={bezet:{offers:[
  {supplier:'BEZET',id:'777',groupId:'501',sku:'X-M',name:'Штаны',vendor:'B',categoryId:'188',price:'1000',quantity:'1',available:'true',pictures:['https://e/1'],params:[{name:'Размер',value:'M'}]},
  {supplier:'BEZET',id:'778',groupId:'501',sku:'X-L',name:'Штаны',vendor:'B',categoryId:'188',price:'1000',quantity:'0',available:'false',pictures:['https://e/1'],params:[{name:'Размер',value:'L'}]},
  {supplier:'BEZET',id:'779',groupId:'501',sku:'X-XL',name:'Штаны',vendor:'B',categoryId:'188',price:'1000',quantity:'1',available:'true',pictures:['https://e/1'],params:[{name:'Размер',value:'XL'}]}
]},militaris:{offers:[
  {supplier:'MILITARIS',id:'1',groupId:'700',sku:'M41',name:'Ботинки',vendor:'M',categoryId:'1258',price:'2000',quantity:'1',available:'true',pictures:['https://e/3'],params:[]},
  {supplier:'MILITARIS',id:'2',groupId:'700',sku:'M42',name:'Ботинки',vendor:'M',categoryId:'1258',price:'2000',quantity:'1',available:'true',pictures:['https://e/3'],params:[]}
]}};
const rows=[{supplier:'BEZET',familyKey:'BEZET:501',groupId:'501',categoryId:'188',name:'Штаны'},{supplier:'MILITARIS',familyKey:'MILITARIS:700',groupId:'700',categoryId:'1258',name:'Ботинки'}];
const mk=(k,n)=>({familyKey:k,content:{titleRu:n,titleUa:n,descriptionRu:'d',descriptionUa:'u',keywordsRu:['x'],keywordsUa:['x'],seo:{},source:{}},dynamic:{pictures:['https://e/f']}});
const out=buildCsvFeed({mode:'full',suppliers,selectedRows:rows,enrichmentItems:[mk('BEZET:501','Штаны'),mk('MILITARIS:700','Ботинки')],promGroups:[{id:157085431},{id:157085437}]});
if(out.summary.exportedRows!==3) throw new Error(`rows ${out.summary.exportedRows}`); // M + XL + one collapsed shoe
if(out.summary.filteredOutOfStockVariants!==1) throw new Error(`filtered ${out.summary.filteredOutOfStockVariants}`);
if(out.csv.includes('"0"') && out.csv.includes('"-"')) throw new Error('zero-stock row leaked');
if(!out.summary.externalIdsUnique) throw new Error('ids');
if(!out.summary.productCodesUnique) throw new Error('codes');
if(out.summary.realVariantFamilies!==1) throw new Error('real');
if(out.summary.collapsedCodeOnlyFamilies!==1) throw new Error('collapsed');
if(out.csv.includes('"Варіант"')) throw new Error('fake variant');
console.log(JSON.stringify(out.summary));
