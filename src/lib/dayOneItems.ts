/** Page 1, points 1 to 4 of the EVRi / DHL Temporary Warehouse Worker Induction v12, in the form's own words. */
export const DAY_ONE_POINTS = [
  { n: 1, title: 'Explain the fire evacuation procedure' },
  {
    n: 2, title: 'Explain the site safety and environmental rules', bullets: [
      'Take reasonable care for your own health and safety as well as that of others and the environment',
      'Never intentionally misuse or recklessly interfere with anything that has been provided in the interests of health and safety or environmental protection',
      'Report any defective equipment immediately to a Manager or Supervisor',
      'Report any leaks, spillage, or damages immediately to a Manager or Supervisor',
      'Hi visibility vests, to EN471, must be worn at all times',
      'Safety footwear, to EN ISO 20345, must be worn at all times',
      'The use of headphones, earpieces, Bluetooth devices and mobile phones is strictly prohibited in the warehouse',
      'Smoking is only permitted within the designated smoking area during designated breaks (explain location of smoking area)',
      'Work areas must be kept tidy at all times',
      'Accidents and/or Near Misses must be reported immediately to a Manager or Supervisor',
      'Never block a fire exit or fire extinguisher',
      'Always use pedestrian walkways',
      'Never use work equipment that you are not trained or authorised to operate',
      'Always use designated waste bins provided',
    ],
  },
  { n: 3, title: 'Identify the location of toilets, washing facilities and canteen' },
  { n: 4, title: 'Explain the worker must ask a manager or supervisor if they have any concerns or questions' },
] as const;

export const DAY_ONE_DECLARATION =
  'Please confirm by declaring below that you have been briefed on all relevant points above and have been given the opportunity to ask questions. You have understood this induction and will take all necessary measures to ensure safe working and pollution prevention practices are maintained and to follow site rules.';
export const SOM_CONFIRMATION =
  'I confirm that I have been verbally briefed in the manual handling guidance, loose loading guidance, and the safe operating methods as identified above and I fully understand the content. I agree to comply with the requirements contained within the instructions at all times. I have been given the opportunity to ask questions.';

export type DayOneInput = {
  footwear: boolean | null; initials: Record<string, string>; repName: string;
  workerSig: string; repSig: string; somSig: string;
};
