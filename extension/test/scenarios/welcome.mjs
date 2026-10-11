export default async ({ shot, click, wait }) => {
  await shot("01-welcome");
  await click("Start");
  await shot("02-start");
  await click("Create a new wallet");
  await wait(800);
  await shot("03-words");
  await click("Tap to show the words");
  await shot("04-words-shown");
};
