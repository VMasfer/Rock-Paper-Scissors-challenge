import { ethers } from 'hardhat';
import { utils } from 'ethers';
import { evm } from '@utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { RockPaperScissors, RPS, RPS__factory } from '@typechained';
import { FakeContract, smock } from '@defi-wonderland/smock';
import { expect } from 'chai';

const FORK_BLOCK_NUMBER = 11298165;

describe('RPS.sol', function () {
  // signers
  let deployer: SignerWithAddress;
  let randomUser: SignerWithAddress;

  // factories
  let rpsFactory: RPS__factory;

  // contracts
  let rps: RPS;
  let mockRockPaperScissors: FakeContract<RockPaperScissors>;

  // misc
  let mockRockPaperScissorsAddress: string;
  let snapshotId: string;

  before(async () => {
    // forking mainnet
    await evm.reset({
      jsonRpcUrl: process.env.RPC_ROPSTEN,
      blockNumber: FORK_BLOCK_NUMBER,
    });

    // getting signers with ETH
    [, deployer, randomUser] = await ethers.getSigners();

    // faking RockPaperScissors contract
    mockRockPaperScissorsAddress = '0x989A31A70cfDb86160d4131fEE7092A8f8702Ed8';
    mockRockPaperScissors = await smock.fake('RockPaperScissors', { address: mockRockPaperScissorsAddress });

    // deploying RPS contract
    rpsFactory = (await ethers.getContractFactory('RPS')) as RPS__factory;
    rps = await rpsFactory.connect(deployer).deploy(mockRockPaperScissors.address);

    // snapshot
    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('constructor(...)', function () {
    it('should execute ERC20 constructor', async () => {
      let name = await rps.name();
      let symbol = await rps.symbol();
      expect(name).to.equal('RockPaperScissors Token');
      expect(symbol).to.equal('RPS');
    });

    it('should execute Ownable constructor', async () => {
      let owner = await rps.owner();
      expect(owner).to.equal(deployer.address);
    });

    it('should store RockPaperScissors address', async () => {
      let cryptoAnts = await rps.rockPaperScissors();
      expect(cryptoAnts).to.equal(mockRockPaperScissors.address);
    });
  });

  describe('updateRockPaperScissorsAddress(...)', function () {
    it('should revert if caller is not the owner', async () => {
      let _rockPaperScissors = '0x0000000000000000000000000000000000000001';
      await expect(rps.connect(randomUser).updateRockPaperScissorsAddress(_rockPaperScissors)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('should emit RockPaperScissorsUpdated', async () => {
      let rockPaperScissors = await rps.rockPaperScissors();
      let _rockPaperScissors = '0x0000000000000000000000000000000000000001';
      await expect(rps.connect(deployer).updateRockPaperScissorsAddress(_rockPaperScissors))
        .to.emit(rps, 'RockPaperScissorsUpdated')
        .withArgs(rockPaperScissors, _rockPaperScissors);
    });

    it('should update RockPaperScissors stored address', async () => {
      let _rockPaperScissors = '0x0000000000000000000000000000000000000001';
      await rps.connect(deployer).updateRockPaperScissorsAddress(_rockPaperScissors);
      let rockPaperScissors = await rps.rockPaperScissors();
      expect(rockPaperScissors).to.equal(_rockPaperScissors);
    });
  });

  describe('mint(...)', function () {
    it('should revert if caller is not the RockPaperScissors contract', async () => {
      let _value = utils.parseEther('1');
      await expect(rps.connect(randomUser).mint(randomUser.address, _value)).to.be.revertedWith(
        'Only the RockPaperScissors contract can call this function'
      );
      await expect(rps.connect(deployer).mint(randomUser.address, _value)).to.be.revertedWith(
        'Only the RockPaperScissors contract can call this function'
      );
      await expect(rps.connect(mockRockPaperScissors.wallet).mint(randomUser.address, _value)).to.not.be.reverted;
    });

    it('should execute _mint', async () => {
      let _value = utils.parseEther('1');
      await deployer.sendTransaction({ to: mockRockPaperScissors.address, value: _value });
      await expect(rps.connect(mockRockPaperScissors.wallet).mint(randomUser.address, _value))
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, randomUser.address, _value);
    });

    it('should emit RPSMinted', async () => {
      let _value = utils.parseEther('1');
      await deployer.sendTransaction({ to: mockRockPaperScissors.address, value: _value });
      await expect(rps.connect(mockRockPaperScissors.wallet).mint(randomUser.address, _value))
        .to.emit(rps, 'RPSMinted')
        .withArgs(randomUser.address, _value);
    });
  });

  describe('burn(...)', function () {
    it('should revert if caller is not the RockPaperScissors contract', async () => {
      let _value = utils.parseEther('1');
      await expect(rps.connect(randomUser).burn(randomUser.address, _value)).to.be.revertedWith(
        'Only the RockPaperScissors contract can call this function'
      );
      await expect(rps.connect(deployer).burn(randomUser.address, _value)).to.be.revertedWith(
        'Only the RockPaperScissors contract can call this function'
      );
      await expect(rps.connect(mockRockPaperScissors.wallet).mint(randomUser.address, _value)).to.not.be.reverted;
    });

    it('should execute _burn', async () => {
      let _value = utils.parseEther('1');
      await deployer.sendTransaction({ to: mockRockPaperScissors.address, value: _value });
      await rps.connect(mockRockPaperScissors.wallet).mint(randomUser.address, _value);
      await expect(rps.connect(mockRockPaperScissors.wallet).burn(randomUser.address, _value))
        .to.emit(rps, 'Transfer')
        .withArgs(randomUser.address, ethers.constants.AddressZero, _value);
    });

    it('should emit RPSBurned', async () => {
      let _value = utils.parseEther('1');
      await deployer.sendTransaction({ to: mockRockPaperScissors.address, value: _value });
      await rps.connect(mockRockPaperScissors.wallet).mint(randomUser.address, _value);
      await expect(rps.connect(mockRockPaperScissors.wallet).burn(randomUser.address, _value))
        .to.emit(rps, 'RPSBurned')
        .withArgs(randomUser.address, _value);
    });
  });

  describe('decimals()', function () {
    it('should return zero', async () => {
      let decimals = await rps.decimals();
      expect(decimals).to.equal(0);
    });
  });
});
