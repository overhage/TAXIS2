import { getStore } from '@netlify/blobs'

export default async () => {
  const csv = `Upload Spreadsheet Column,Prisma Master Field,Category
cooc_obs,cooc_obs,Count
cooc_event_count,cooc_event_count,Count
na,na,Count
nb,nb,Count
total_persons,total_persons,Count
a_before_b,a_before_b,Count
same_day,same_day,Count
b_before_a,b_before_a,Count
expected_obs,expected_obs,Stat
lift,lift,Stat
lift_lower_95,lift_lower_95,Stat
lift_upper_95,lift_upper_95,Stat
z_score,z_score,Stat
ab_h,ab_h,Stat
a_only_h,a_only_h,Stat
b_only_h,b_only_h,Stat
neither_h,neither_h,Stat
odds_ratio,odds_ratio,Stat
or_lower_95,or_lower_95,Stat
or_upper_95,or_upper_95,Stat
directionality_ratio,directionality_ratio,Stat
dir_prop_a_before_b,dir_prop_a_before_b,Stat
dir_lower_95,dir_lower_95,Stat
dir_upper_95,dir_upper_95,Stat
confidence_a_to_b,confidence_a_to_b,Stat
confidence_b_to_a,confidence_b_to_a,Stat`;

  await getStore('config').set('MasterRecord Fields.csv', csv, { contentType: 'text/csv' });
  return new Response('ok', { status: 200 });
}
