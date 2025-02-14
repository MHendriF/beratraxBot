import axios from 'axios';
import dotenv from 'dotenv';
import log from './utils/logger.js';
import iniBapakBudi from './utils/banner.js';
import zapAndStake from './utils/stake.js';
import {
  delay,
  newAgent,
  readFile,
  readWallets,
  solveCaptcha,
  askQuestion,
} from './utils/helper.js';

// Load environment variables
dotenv.config();

const CAPTCHA_SOLVER_API_KEY = process.env.CAPTCHA_SOLVER_API_KEY;
const CAPTCHA_SOLVER_TYPE = process.env.CAPTCHA_SOLVER_TYPE;

// Validasi jenis Captcha Solver
if (!['1', '2', '3'].includes(CAPTCHA_SOLVER_TYPE)) {
  log.error(
    'Invalid CAPTCHA_SOLVER_TYPE in .env file. Please set it to 1, 2, or 3.'
  );
  process.exit(1); // Keluar dari program jika jenis Captcha Solver tidak valid
}

async function claimTokens(address, proxy, useCaptcha = false, retries = 3) {
  const agent = newAgent(proxy);
  const url = `https://bartiofaucet.berachain.com/api/claim?address=${address}`;
  const data = { address };
  const captcha = useCaptcha
    ? await solveCaptcha(CAPTCHA_SOLVER_API_KEY, CAPTCHA_SOLVER_TYPE)
    : '';

  log.info(`Trying to claim faucet for address ${address}...`);
  try {
    const response = await axios.post(url, data, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${captcha}`,
      },
      httpsAgent: agent,
    });

    log.info('Claim Faucet Result:', response.data);
    return response.data;
  } catch (error) {
    if (error.response?.status === 402) {
      log.error(
        `You need at least 0.001 ETH on Ethereum Mainnet to use the faucet.`
      );
    } else if (error.response?.status === 401) {
      log.error(`Captcha required, trying to solve captcha...`);
      return 401;
    } else if (error.response?.status === 429) {
      log.warn(
        `Rate limited. Use a proxy if this wallet hasn't claimed the faucet before.`
      );
      return 'claimed';
    } else {
      log.error(
        `Error claiming faucet. Retries left: ${retries}`,
        error.response?.statusText || error.message
      );
      await delay(2);
      if (retries > 0)
        return await claimTokens(address, proxy, useCaptcha, retries - 1);
      else return null;
    }
  }
}

async function setConnector(address, proxy, retries = 3) {
  const agent = newAgent(proxy);
  const url =
    'https://beratrax-api-ae00332865bc.herokuapp.com/api/v1/account/set-connector';
  const data = { address, connector: 'io.metamask' };

  try {
    const response = await axios.post(url, data, { httpsAgent: agent });
    log.info('Set connector result:', response.data);
  } catch (error) {
    log.error(
      'Error setting connector:',
      error.response?.statusText || error.message
    );
    if (retries > 0) return await setConnector(address, proxy, retries - 1);
  }
}

async function createAccount(address, proxy, retries = 3) {
  const agent = newAgent(proxy);
  const url = 'https://beratrax-api-ae00332865bc.herokuapp.com/api/v1/account';
  const data = { address, referrer: 'GeognosticalBera' };

  try {
    const response = await axios.post(url, data, { httpsAgent: agent });
    if (response?.data?.error) return null;
    log.info('Create account result:', response.data);
  } catch (error) {
    log.error(
      'Error creating account:',
      error.response?.statusText || error.message
    );
    if (retries > 0) return await createAccount(address, proxy, retries - 1);
  }
}

async function claimPointsFromFollow(address, proxy, retries = 3) {
  const agent = newAgent(proxy);
  const url =
    'https://beratrax-api-ae00332865bc.herokuapp.com/api/v1/account/send-btx-for-x-follow';
  const data = { address };

  try {
    const response = await axios.post(url, data, { httpsAgent: agent });
    log.info('Claim Free Trax result:', response.data);
  } catch (error) {
    log.error(
      'Error claiming Free Trax:',
      error.response?.statusText || error.message
    );
    if (retries > 0)
      return await claimPointsFromFollow(address, proxy, retries - 1);
  }
}

async function getPointsUser(address, proxy, retries = 3) {
  const agent = newAgent(proxy);
  const url = `https://beratrax-api-ae00332865bc.herokuapp.com/api/v1/stats/tvl?address=${address}`;

  try {
    const { data } = await axios.get(url, { httpsAgent: agent });
    const result = {
      earnedTrax: data.data[0]?.earnedTrax,
      estimatedTraxPerDay:
        data.data[0]?.estimatedTraxPerDay[0]?.estimatedTraxPerDay || 0,
      leaderboardRanking: data.data[0]?.leaderboardRanking,
      tvl: data.data[0]?.tvl,
    };
    log.info('Address Info result:', result);
  } catch (error) {
    log.error(
      'Error checking address info:',
      error.response?.statusText || error.message
    );
    if (retries > 0) return await getPointsUser(address, proxy, retries - 1);
  }
}

async function updateHistoryTx(address, proxy, amount, retries = 3) {
  const agent = newAgent(proxy);
  const url =
    'https://beratrax-api-ae00332865bc.herokuapp.com/api/v1/transaction/save-history-tx';
  const data = {
    from: address,
    amountInWei: amount,
    date: new Date().toString(),
    type: 'deposit',
    farmId: 1001,
    max: false,
    token: '0x0000000000000000000000000000000000000000',
    steps: [
      { status: 'COMPLETED', type: 'Zap In', amount: amount },
      { status: 'COMPLETED', type: 'Stake into reward vault', amount: amount },
    ],
  };

  try {
    log.info(`Updating history tx for ${address}...`);
    const response = await axios.post(url, data, { httpsAgent: agent });
    if (response?.data?.error) return null;
    log.info('Update history tx result:', response.data);
  } catch (error) {
    log.error(
      'Error updating history tx:',
      error.response?.statusText || error.message
    );
    if (retries > 0)
      return await updateHistoryTx(address, proxy, amount, retries - 1);
  }
}

async function processWallet(wallet, proxy) {
  const { address, privateKey } = wallet;
  log.info(`Processing wallet ${address} with proxy:`, proxy);

  await setConnector(address, proxy);
  await createAccount(address, proxy);
  await getPointsUser(address, proxy);

  const isClaimed = await claimTokens(address, proxy);
  if (isClaimed === 401) {
    await claimTokens(address, proxy, true);
  }

  const zapAndStakeResult = await zapAndStake(privateKey, isClaimed);
  if (zapAndStakeResult) {
    log.info(`On-Chain Result:`, zapAndStakeResult);
    const amount = zapAndStakeResult?.balance || 0;
    if (amount) {
      await updateHistoryTx(address, proxy, amount);
    }
  }
}

async function main() {
  log.info(iniBapakBudi);
  await delay(3);

  const wallets = await readWallets();
  if (wallets.length === 0) {
    log.error(
      "No wallets found. Please create wallets first using 'npm run setup'."
    );
    return;
  }

  const proxies = await readFile('proxy.txt');
  if (proxies.length === 0) log.warn('Running without proxy...');

  let isClaimedReward = false;

  while (true) {
    for (const wallet of wallets) {
      const proxy = proxies[wallets.indexOf(wallet) % proxies.length] || null;
      try {
        await processWallet(wallet, proxy);
        if (!isClaimedReward) {
          await claimPointsFromFollow(wallet.address, proxy);
        }
      } catch (error) {
        log.error('Error processing wallet:', error.message);
      }
    }
    isClaimedReward = true;
    log.info(`All wallets processed. Waiting 8 hours before the next run...`);
    await delay(8 * 60 * 60);
  }
}

main();
