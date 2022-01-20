import { ethers } from 'hardhat';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { shouldVerifyContract } from 'utils/deploy';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const currentNonce: number = await ethers.provider.getTransactionCount(deployer);

  // precalculate the address of RPS contract
  const rpsAddress: string = ethers.utils.getContractAddress({ from: deployer, nonce: currentNonce + 1 });

  const rockPaperScissorsHelperArgs = [rpsAddress];

  const rockPaperScissors = await hre.deployments.deploy('RockPaperScissors', {
    contract: 'contracts/RockPaperScissors.sol:RockPaperScissors',
    args: rockPaperScissorsHelperArgs,
    from: deployer,
    log: true,
  });

  if (hre.network.name !== 'hardhat' && (await shouldVerifyContract(rockPaperScissors))) {
    await hre.run('verify:verify', {
      address: rockPaperScissors.address,
      constructorArguments: rockPaperScissorsHelperArgs,
    });
  }

  const rpsArgs = [rockPaperScissors.address];

  const rps = await hre.deployments.deploy('RPS', {
    contract: 'contracts/RPS.sol:RPS',
    args: rpsArgs,
    from: deployer,
    log: true,
  });

  if (hre.network.name !== 'hardhat' && (await shouldVerifyContract(rps))) {
    await hre.run('verify:verify', {
      address: rps.address,
      constructorArguments: rpsArgs,
    });
  }
};

deployFunction.tags = ['RockPaperScissors', 'RPS', 'testnet'];

export default deployFunction;
