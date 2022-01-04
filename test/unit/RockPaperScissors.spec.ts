import { ethers, network } from 'hardhat';
import { utils } from 'ethers';
import { evm } from '@utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { RockPaperScissors, RockPaperScissors__factory, RPS, RPS__factory } from '@typechained';
import { expect } from 'chai';

const FORK_BLOCK_NUMBER = 11298165;

describe('RockPaperScissors', function () {
  // signers
  let deployer: SignerWithAddress;
  let player1: SignerWithAddress;
  let player2: SignerWithAddress;

  // factories
  let rockPaperScissorsFactory: RockPaperScissors__factory;
  let rpsFactory: RPS__factory;

  // contracts
  let rockPaperScissors: RockPaperScissors;
  let rps: RPS;

  // misc
  let rpsPrecalculatedAddress: string;
  let snapshotId: string;

  before(async () => {
    // forking mainnet
    await evm.reset({
      jsonRpcUrl: process.env.RPC_ROPSTEN,
      blockNumber: FORK_BLOCK_NUMBER,
    });

    // getting signers with ETH
    [, deployer, player1, player2] = await ethers.getSigners();

    // precalculating RPS contract address as both RockPaperScissors contract and RPS contract depend on each other
    const currentNonce = await ethers.provider.getTransactionCount(deployer.address);
    rpsPrecalculatedAddress = utils.getContractAddress({ from: deployer.address, nonce: currentNonce + 1 });

    // deploying contracts
    rockPaperScissorsFactory = (await ethers.getContractFactory('RockPaperScissors')) as RockPaperScissors__factory;
    rockPaperScissors = await rockPaperScissorsFactory.connect(deployer).deploy(rpsPrecalculatedAddress);
    rpsFactory = (await ethers.getContractFactory('RPS')) as RPS__factory;
    rps = await rpsFactory.connect(deployer).deploy(rockPaperScissors.address);

    // snapshot
    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('RockPaperScissors.sol', function () {
    it('constructor(address _rpsContractAddress)', async () => {
      expect(await rockPaperScissors.owner()).to.equal(deployer.address);
      expect(await rockPaperScissors.rps()).to.equal(rps.address);
    });

    it('receive()', async () => {
      let _value = utils.parseEther('0');
      await expect(deployer.sendTransaction({ to: rockPaperScissors.address, value: _value }))
        .to.not.emit(rockPaperScissors, 'Received')
        .withArgs(deployer.address, _value);
      _value = utils.parseEther('1');
      await expect(deployer.sendTransaction({ to: rockPaperScissors.address, value: _value }))
        .to.emit(rockPaperScissors, 'Received')
        .withArgs(deployer.address, _value);
    });

    it('fallback()', async () => {
      let _value = utils.parseEther('0');
      await expect(deployer.sendTransaction({ to: rockPaperScissors.address, value: _value, data: '0x1e51' })).to.be.revertedWith(
        'Wrong call to contract'
      );
      _value = utils.parseEther('1');
      await expect(deployer.sendTransaction({ to: rockPaperScissors.address, value: _value, data: '0x1e51' })).to.be.revertedWith(
        'Wrong call to contract'
      );
    });

    it('buyRPS()', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let amount = 1;
      await expect(rockPaperScissors.buyRPS()).to.be.revertedWith('Wrong ether sent');
      await expect(rockPaperScissors.buyRPS({ value: rpsPrice.mul(amount).sub(1) })).to.be.revertedWith('Wrong ether sent');
      await expect(rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) }))
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, player1.address, amount)
        .to.emit(rockPaperScissors, 'RPSBought')
        .withArgs(player1.address, amount);
    });

    it('sellRPS(uint256 _amount)', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let rpsFee = await rockPaperScissors.rpsFee();
      let amount = 1;
      let rpsBidPrice = rpsPrice.mul(amount).sub(rpsPrice.mul(amount).mul(rpsFee).div(100));
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) });
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) });
      await expect(rockPaperScissors.sellRPS(0)).to.be.revertedWith('Token amount cannot be zero');
      await expect(rockPaperScissors.sellRPS(amount)).to.be.revertedWith('ERC20: burn amount exceeds balance');
      await expect(rockPaperScissors.connect(player1).sellRPS(amount))
        .to.emit(rps, 'Transfer')
        .withArgs(player1.address, ethers.constants.AddressZero, amount)
        .to.emit(rockPaperScissors, 'RPSSold')
        .withArgs(player1.address, amount);
      await expect(() => rockPaperScissors.connect(player1).sellRPS(amount)).to.changeEtherBalances(
        [rockPaperScissors, player1],
        [-rpsBidPrice, rpsBidPrice]
      );
    });

    it('createGame(bytes32 _encryptedMove, uint256 _bet, uint16 _duration)', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = 1;
      let duration = 300;
      let status = 0;
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await expect(rockPaperScissors.createGame(encryptedMove, ethers.constants.MaxUint256, duration)).to.be.revertedWith('The bet is too big');
      await expect(rockPaperScissors.createGame(encryptedMove, bet, duration)).to.be.revertedWith('ERC20: burn amount exceeds balance');
      let gameId = await rockPaperScissors.gamesCreated();
      await expect(rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration))
        .to.emit(rps, 'Transfer')
        .withArgs(player1.address, ethers.constants.AddressZero, bet)
        .to.emit(rockPaperScissors, 'GameCreated')
        .withArgs(player1.address, gameId, []);
      let game0 = [
        gameId,
        player1.address,
        ethers.constants.AddressZero,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(0),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      expect(await rockPaperScissors.games(0)).to.eql(game0);
      expect(await rockPaperScissors.gamesCreated()).to.equal(1);
      let playerId = await rockPaperScissors.totalPlayerIds();
      expect(await rockPaperScissors.playerToId(player1.address)).to.equal(playerId);
    });

    it('quitGame(uint256 _gameId)', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = 1;
      let duration = 300;
      let status = 0;
      await expect(rockPaperScissors.quitGame(0)).to.be.revertedWith('The games list is empty');
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let game0 = [
        gameId,
        player1.address,
        ethers.constants.AddressZero,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(0),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, 500);
      await rockPaperScissors.connect(player1).playGame(1, 1);
      await expect(rockPaperScissors.quitGame(2)).to.be.revertedWith('Game does not exist');
      await expect(rockPaperScissors.quitGame(1)).to.be.revertedWith('Game has already started');
      await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Player 1 is not you');
      await expect(rockPaperScissors.connect(player1).quitGame(gameId))
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, player1.address, bet)
        .to.emit(rockPaperScissors, 'GameDeleted')
        .withArgs(player1.address, gameId, []);
      expect(await rockPaperScissors.games(0)).to.not.eql(game0);
      await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Game has been deleted');
    });

    it('playGame(uint256 _gameId, Hand _move)', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 3;
      let bet = 1;
      let duration = 300;
      let status = 1;
      await expect(rockPaperScissors.playGame(0, 0)).to.be.revertedWith('The games list is empty');
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player2).buyRPS({ value: rpsPrice.mul(bet) });
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, 500);
      await expect(rockPaperScissors.playGame(2, 0)).to.be.revertedWith('Game does not exist');
      await expect(rockPaperScissors.playGame(gameId, 0)).to.be.revertedWith('Invalid move');
      await expect(rockPaperScissors.playGame(gameId, move)).to.be.revertedWith('ERC20: burn amount exceeds balance');
      await expect(rockPaperScissors.connect(player2).playGame(gameId, move))
        .to.emit(rps, 'Transfer')
        .withArgs(player1.address, ethers.constants.AddressZero, bet)
        .to.emit(rockPaperScissors, 'GameStarted')
        .withArgs(player2.address, gameId, []);
      let latestBlock = await ethers.provider.getBlock('latest');
      let game0 = [
        gameId,
        player1.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      expect(await rockPaperScissors.games(0)).to.eql(game0);
      let playerId = await rockPaperScissors.totalPlayerIds();
      expect(await rockPaperScissors.playerToId(player2.address)).to.equal(playerId);
      await expect(rockPaperScissors.playGame(gameId, 0)).to.be.revertedWith('Game has already started');
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d');
      await expect(rockPaperScissors.playGame(gameId, 0)).to.be.revertedWith('Game has been deleted');
    });

    it('endGameAsPlayer1(uint256 _gameId, bytes calldata _seed)', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 1;
      let bet = 1;
      let duration = 300;
      await expect(rockPaperScissors.endGameAsPlayer1(0, '0x533d')).to.be.revertedWith('The games list is empty');
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player2).buyRPS({ value: rpsPrice.mul(bet) });
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, 500);
      await expect(rockPaperScissors.endGameAsPlayer1(2, '0x533d')).to.be.revertedWith('Game does not exist');
      await expect(rockPaperScissors.endGameAsPlayer1(gameId, '0x533d')).to.be.revertedWith('Game has not started yet');
      let moveSnapshot = await evm.snapshot.take();
      let move = 1;
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      let latestBlock = await ethers.provider.getBlock('latest');
      await expect(rockPaperScissors.endGameAsPlayer1(gameId, '0x533d')).to.be.revertedWith('Player 1 is not you');
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x01')).to.be.revertedWith('Decryption failed');
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d'))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, [])
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, player1.address, bet);
      let status = 4;
      let game0 = [
        gameId,
        player1.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      expect(await rockPaperScissors.games(0)).to.eql(game0);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d')).to.be.revertedWith('Game has already ended');
      await evm.snapshot.revert(moveSnapshot);
      move = 2;
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d'))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, []);
      status = 3;
      game0 = [
        gameId,
        player1.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      expect(await rockPaperScissors.games(0)).to.eql(game0);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d')).to.be.revertedWith('Game has already ended');
      await evm.snapshot.revert(moveSnapshot);
      move = 3;
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d'))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, [])
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, player1.address, bet * 2)
        .to.emit(rockPaperScissors, 'GameDeleted')
        .withArgs(player1.address, gameId, []);
      status = 2;
      game0 = [
        gameId,
        player1.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      expect(await rockPaperScissors.games(0)).to.not.eql(game0);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d')).to.be.revertedWith('Game has been deleted');
    });

    it('endGameAsPlayer2(uint256 _gameId)', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 1;
      let bet = 1;
      let duration = 300;
      await expect(rockPaperScissors.endGameAsPlayer2(0)).to.be.revertedWith('The games list is empty');
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player2).buyRPS({ value: rpsPrice.mul(bet) });
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, 500);
      await expect(rockPaperScissors.endGameAsPlayer2(2)).to.be.revertedWith('Game does not exist');
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Player 2 is not you');
      let moveSnapshot = await evm.snapshot.take();
      let move = 1;
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      let latestBlock = await ethers.provider.getBlock('latest');
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d');
      let status = 4;
      let game0 = [
        gameId,
        player1.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, player2.address, bet)
        .to.emit(rockPaperScissors, 'GameDeleted')
        .withArgs(player2.address, gameId, []);
      expect(await rockPaperScissors.games(0)).to.not.eql(game0);
      await evm.snapshot.revert(moveSnapshot);
      move = 2;
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d');
      status = 3;
      game0 = [
        gameId,
        player1.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, player2.address, bet * 2)
        .to.emit(rockPaperScissors, 'GameDeleted')
        .withArgs(player2.address, gameId, []);
      expect(await rockPaperScissors.games(0)).to.not.eql(game0);
      await evm.snapshot.revert(moveSnapshot);
      move = 3;
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Player 1 still has time to reveal his move');
      await evm.advanceToTimeAndBlock(latestBlock.timestamp - 1 + duration);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player2.address, gameId, [])
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, player2.address, bet * 2)
        .to.emit(rockPaperScissors, 'GameDeleted')
        .withArgs(player2.address, gameId, []);
      game0 = [
        gameId,
        player1.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      expect(await rockPaperScissors.games(0)).to.not.eql(game0);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Game has been deleted');
    });

    it('withdrawEtherBalance(uint256 _amount)', async () => {
      let amount = 100000;
      await expect(rockPaperScissors.connect(player1).withdrawEtherBalance(amount)).to.be.revertedWith('Ownable: caller is not the owner');
      await expect(rockPaperScissors.connect(deployer).withdrawEtherBalance(amount)).to.be.revertedWith('Insufficient ether in balance');
      await deployer.sendTransaction({ to: rockPaperScissors.address, value: amount });
      await expect(() => rockPaperScissors.connect(deployer).withdrawEtherBalance(amount)).to.changeEtherBalances(
        [rockPaperScissors, deployer],
        [-amount, amount]
      );
    });

    it('withdrawERC20Token(address _tokenContractAddress, uint256 _amount)', async () => {
      let tokenContract = rps;
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let amount = 1;
      await expect(rockPaperScissors.connect(player1).withdrawERC20Token(tokenContract.address, amount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
      await expect(rockPaperScissors.connect(deployer).withdrawERC20Token(tokenContract.address, amount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      );
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) });
      await tokenContract.connect(player1).transfer(rockPaperScissors.address, amount);
      await expect(rockPaperScissors.connect(deployer).withdrawERC20Token(tokenContract.address, amount))
        .to.emit(tokenContract, 'Transfer')
        .withArgs(rockPaperScissors.address, deployer.address, amount);
    });

    it('setRPSPrice(uint256 _rpsPrice)', async () => {
      let _rpsPrice = 100;
      await expect(rockPaperScissors.connect(player1).setRPSPrice(0)).to.be.revertedWith('Ownable: caller is not the owner');
      await expect(rockPaperScissors.connect(deployer).setRPSPrice(0)).to.be.revertedWith('Token price cannot be zero');
      await rockPaperScissors.connect(deployer).setRPSPrice(_rpsPrice);
      expect(await rockPaperScissors.rpsPrice()).to.equal(_rpsPrice);
    });

    it('setRPSFee(uint8 _rpsFee)', async () => {
      let _rpsFee = 100;
      await expect(rockPaperScissors.connect(player1).setRPSFee(101)).to.be.revertedWith('Ownable: caller is not the owner');
      await expect(rockPaperScissors.connect(deployer).setRPSFee(101)).to.be.revertedWith('Invalid fee percentage');
      await rockPaperScissors.connect(deployer).setRPSFee(_rpsFee);
      expect(await rockPaperScissors.rpsFee()).to.equal(_rpsFee);
    });

    it('Getters (games and players)', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 1;
      let bet = 1;
      let duration = 300;
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let move = 1;
      await rockPaperScissors.connect(player1).playGame(gameId, move);
      let latestBlock = await ethers.provider.getBlock('latest');
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d');
      let status = 4;
      let game0 = [
        gameId,
        player1.address,
        player1.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await rockPaperScissors.connect(player2).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player2).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player2).buyRPS({ value: rpsPrice.mul(bet) });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      move = 2;
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      latestBlock = await ethers.provider.getBlock('latest');
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, '0x533d');
      status = 3;
      let game1 = [
        gameId,
        player2.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      await rockPaperScissors.connect(player2).buyRPS({ value: rpsPrice.mul(bet) });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      latestBlock = await ethers.provider.getBlock('latest');
      decryptedMove = 0;
      status = 1;
      let game2 = [
        gameId,
        player1.address,
        player2.address,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(latestBlock.timestamp),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await rockPaperScissors.connect(player2).buyRPS({ value: rpsPrice.mul(bet) });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      move = 0;
      status = 0;
      let game3 = [
        gameId,
        player2.address,
        ethers.constants.AddressZero,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(0),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let game4 = [
        gameId,
        player1.address,
        ethers.constants.AddressZero,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(0),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(bet) });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let game5 = [
        gameId,
        player1.address,
        ethers.constants.AddressZero,
        ethers.BigNumber.from(bet),
        duration,
        ethers.BigNumber.from(0),
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      expect(await rockPaperScissors.getGames()).to.eql([game0, game1, game2, game3, game4, game5]);
      expect(await rockPaperScissors.getAvailableGames()).to.eql([game3, game4, game5]);
      expect(await rockPaperScissors.getAvailableGamesByPlayer(player1.address)).to.eql([game4, game5]);
      expect(await rockPaperScissors.getAvailablePlayers()).to.eql([player2.address, player1.address]);
      expect(await rockPaperScissors.getActiveGames()).to.eql([game0, game1, game2]);
      expect(await rockPaperScissors.getActiveGamesByPlayer(player2.address)).to.eql([game1, game2]);
      expect(await rockPaperScissors.getActivePlayers()).to.eql([player1.address, player2.address]);
    });

    it('getEtherBalance()', async () => {
      let amount = 100000;
      await deployer.sendTransaction({ to: rockPaperScissors.address, value: amount });
      expect(await rockPaperScissors.getEtherBalance()).to.equal(await rockPaperScissors.provider.getBalance(rockPaperScissors.address));
    });
  });

  describe('RPS.sol', function () {
    it("constructor(address _rockPaperScissors) ERC20('RockPaperScissors Token', 'RPS')", async () => {
      expect(await rps.name()).to.equal('RockPaperScissors Token');
      expect(await rps.symbol()).to.equal('RPS');
      expect(await rps.owner()).to.equal(deployer.address);
      expect(await rps.rockPaperScissors()).to.equal(rockPaperScissors.address);
    });

    it('updateRockPaperScissorsAddress(address _rockPaperScissors)', async () => {
      let _rockPaperScissors = '0x0000000000000000000000000000000000000000';
      await expect(rps.connect(player1).updateRockPaperScissorsAddress(_rockPaperScissors)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
      await rps.connect(deployer).updateRockPaperScissorsAddress(_rockPaperScissors);
      expect(await rps.rockPaperScissors()).to.equal(_rockPaperScissors);
    });

    it('mint(address _to, uint256 _amount)', async () => {
      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [rockPaperScissors.address],
      });
      const _rockPaperScissors = ethers.provider.getSigner(rockPaperScissors.address);
      let _value = utils.parseEther('1');
      let amount = 1;
      await deployer.sendTransaction({ to: rockPaperScissors.address, value: _value });
      await expect(rps.mint(player1.address, amount)).to.be.revertedWith('Only the RockPaperScissors contract can call this function');
      await expect(rps.connect(_rockPaperScissors).mint(player1.address, amount))
        .to.emit(rps, 'Transfer')
        .withArgs(ethers.constants.AddressZero, player1.address, amount);
      expect(await rps.totalSupply()).to.equal(amount);
      expect(await rps.balanceOf(player1.address)).to.equal(amount);
      await network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [rockPaperScissors.address],
      });
    });

    it('burn(address _from, uint256 _amount)', async () => {
      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [rockPaperScissors.address],
      });
      const _rockPaperScissors = ethers.provider.getSigner(rockPaperScissors.address);
      let _value = utils.parseEther('1');
      let amount = 1;
      await deployer.sendTransaction({ to: rockPaperScissors.address, value: _value });
      await rps.connect(_rockPaperScissors).mint(player1.address, amount * 2);
      await expect(rps.burn(player1.address, amount)).to.be.revertedWith('Only the RockPaperScissors contract can call this function');
      await expect(rps.connect(_rockPaperScissors).burn(player2.address, amount)).to.be.revertedWith('ERC20: burn amount exceeds balance');
      await expect(rps.connect(_rockPaperScissors).burn(player1.address, amount))
        .to.emit(rps, 'Transfer')
        .withArgs(player1.address, ethers.constants.AddressZero, amount);
      expect(await rps.balanceOf(player1.address)).to.equal(amount);
      expect(await rps.totalSupply()).to.equal(amount);
      await network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [rockPaperScissors.address],
      });
    });

    it('decimals()', async () => {
      expect(await rps.decimals()).to.equal(0);
    });
  });
});
