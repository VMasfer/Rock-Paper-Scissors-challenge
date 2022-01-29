import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { shouldVerifyContract } from 'utils/deploy';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const rockPaperScissors = await hre.deployments.deploy('RockPaperScissors', {
    contract: 'contracts/RockPaperScissors.sol:RockPaperScissors',
    from: deployer,
    log: true,
  });

  if (hre.network.name !== 'hardhat' && (await shouldVerifyContract(rockPaperScissors))) {
    await hre.run('verify:verify', {
      address: rockPaperScissors.address,
    });
  }
};

deployFunction.tags = ['RockPaperScissors', 'testnet'];

export default deployFunction;
