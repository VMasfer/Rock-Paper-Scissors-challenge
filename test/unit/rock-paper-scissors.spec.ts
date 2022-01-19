import { ethers } from 'hardhat';
import { utils } from 'ethers';
import { evm } from '@utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { RockPaperScissors, RockPaperScissors__factory, RPS } from '@typechained';
import { FakeContract, smock } from '@defi-wonderland/smock';
import chai, { expect } from 'chai';

chai.use(smock.matchers);

const FORK_BLOCK_NUMBER = 11298165;

describe('RockPaperScissors.sol', function () {
  // signers
  let deployer: SignerWithAddress;
  let player1: SignerWithAddress;
  let player2: SignerWithAddress;

  // factories
  let rockPaperScissorsFactory: RockPaperScissors__factory;

  // contracts
  let rockPaperScissors: RockPaperScissors;
  let mockRPS: FakeContract<RPS>;

  // misc
  let mockRPSAddress: string;
  let snapshotId: string;

  before(async () => {
    // forking mainnet
    await evm.reset({
      jsonRpcUrl: process.env.RPC_ROPSTEN,
      blockNumber: FORK_BLOCK_NUMBER,
    });

    // getting signers with ETH
    [, deployer, player1, player2] = await ethers.getSigners();

    // faking Egg contract
    mockRPSAddress = '0x989A31A70cfDb86160d4131fEE7092A8f8702Ed8';
    mockRPS = await smock.fake('RPS', { address: mockRPSAddress });

    // deploying RockPaperScissors contract
    rockPaperScissorsFactory = (await ethers.getContractFactory('RockPaperScissors')) as RockPaperScissors__factory;
    rockPaperScissors = await rockPaperScissorsFactory.connect(deployer).deploy(mockRPS.address);

    // snapshot
    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('constructor(...)', function () {
    it('should execute Ownable constructor', async () => {
      let owner = await rockPaperScissors.owner();
      expect(owner).to.equal(deployer.address);
    });

    it('should initialize rps interface', async () => {
      let rps = await rockPaperScissors.rps();
      expect(rps).to.equal(mockRPS.address);
    });
  });

  describe('receive()', function () {
    it('should not emit EtherReceived when ether sent is zero', async () => {
      let _value = utils.parseEther('0');
      let tx = deployer.sendTransaction({ to: rockPaperScissors.address, value: _value });
      await expect(tx).to.not.emit(rockPaperScissors, 'EtherReceived');
    });

    it('should emit EtherReceived when ether sent is greater than zero', async () => {
      let _value = utils.parseEther('1');
      let tx = deployer.sendTransaction({ to: rockPaperScissors.address, value: _value });
      await expect(tx).to.emit(rockPaperScissors, 'EtherReceived').withArgs(deployer.address, _value);
    });
  });

  describe('fallback()', function () {
    it('should revert if transaction data is sent', async () => {
      let tx = deployer.sendTransaction({ to: rockPaperScissors.address, data: '0x1e51' });
      await expect(tx).to.be.revertedWith('Wrong call to contract');
    });

    it('should revert if transaction data and ether are sent', async () => {
      let _value = utils.parseEther('1');
      let tx = deployer.sendTransaction({ to: rockPaperScissors.address, value: _value, data: '0x1e51' });
      await expect(tx).to.be.revertedWith('Wrong call to contract');
    });
  });

  describe('buyRPS()', function () {
    it('should revert if ether sent cannot buy exactly a natural number of RPS', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      await expect(rockPaperScissors.buyRPS({ value: 0 })).to.be.revertedWith('Wrong ether sent');
      await expect(rockPaperScissors.buyRPS({ value: rpsPrice.sub(1) })).to.be.revertedWith('Wrong ether sent');
    });

    it('should call to mint RPS', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let amount = 3;
      mockRPS.mint.reset();
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) });
      expect(mockRPS.mint).to.have.been.calledOnceWith(player1.address, amount);
    });

    it('should emit RPSBought', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let amount = 3;
      await expect(rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) }))
        .to.emit(rockPaperScissors, 'RPSBought')
        .withArgs(player1.address, amount);
    });
  });

  describe('sellRPS(...)', function () {
    it('should revert if trying to sell zero RPS', async () => {
      let amount = 0;
      await expect(rockPaperScissors.sellRPS(amount)).to.be.revertedWith('Token amount cannot be zero');
    });

    it('should call to burn RPS', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let amount = 3;
      mockRPS.burn.reset();
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) });
      await rockPaperScissors.connect(player1).sellRPS(amount);
      expect(mockRPS.burn).to.have.been.calledOnceWith(player1.address, amount);
    });

    it('should emit RPSSold', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let amount = 3;
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) });
      await expect(rockPaperScissors.connect(player1).sellRPS(amount)).to.emit(rockPaperScissors, 'RPSSold').withArgs(player1.address, amount);
    });

    it('should change ether balances', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let rpsFee = await rockPaperScissors.rpsFee();
      let rpsBidPrice = rpsPrice.sub(rpsPrice.mul(rpsFee).div(100));
      let amount = 1;
      await rockPaperScissors.connect(player1).buyRPS({ value: rpsPrice.mul(amount) });
      await expect(() => rockPaperScissors.connect(player1).sellRPS(amount)).to.changeEtherBalances(
        [rockPaperScissors, player1],
        [-rpsBidPrice.mul(amount), rpsBidPrice.mul(amount)]
      );
    });
  });

  describe('createGame(...)', function () {
    it('should revert if the bet is too big', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let duration = 300;
      await expect(rockPaperScissors.createGame(encryptedMove, ethers.constants.MaxUint256, duration)).to.be.revertedWith('The bet is too big');
    });

    it('should call to burn RPS', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      mockRPS.burn.reset();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      expect(mockRPS.burn).to.have.been.calledOnceWith(player1.address, bet);
    });

    it('should increment gamesCreated', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      for (let i = 1; i <= 3; i++) {
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        let gamesCreated = await rockPaperScissors.gamesCreated();
        expect(gamesCreated).to.equal(i);
      }
    });

    it('should create a game', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let timestamp = ethers.BigNumber.from(0);
      let status = 0;
      let newGame = [
        gameId,
        player1.address,
        ethers.constants.AddressZero,
        bet,
        duration,
        timestamp,
        encryptedMove,
        decryptedMove,
        move,
        status,
      ];
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let games = await rockPaperScissors.getGames();
      expect(games).to.eql([newGame]);
    });

    it('should emit GameCreated', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      await expect(rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration))
        .to.emit(rockPaperScissors, 'GameCreated')
        .withArgs(player1.address, gameId, []);
    });

    it('should increment totalPlayerIds if the caller is a new player', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      for (let i = 0; i < 3; i++) {
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
        expect(totalPlayerIds).to.equal(1);
      }
      for (let i = 3; i < 6; i++) {
        await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
        let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
        expect(totalPlayerIds).to.equal(2);
      }
    });

    it('should assign an ID only to new players', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
      let player1Id = await rockPaperScissors.playerToId(player1.address);
      expect(player1Id).to.equal(totalPlayerIds);
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      expect(player1Id).to.equal(totalPlayerIds);
    });
  });

  describe('quitGame(...)', function () {
    describe('checkGame(...)', function () {
      it('should revert if the games list is empty', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('The games list is empty');
      });

      it('should revert if the game does not exist', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await expect(rockPaperScissors.quitGame(gameId.add(1))).to.be.revertedWith('Game does not exist');
      });

      it('should revert if the game was deleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.quitGame(gameId);
        await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Game has been deleted');
      });

      it('should revert if the game already started', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.playGame(gameId, move);
        await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Game has already started');
      });

      it('should revert if caller is not player 1', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Player 1 is not you');
      });
    });

    it('should call to mint RPS', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      mockRPS.mint.reset();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).quitGame(gameId);
      expect(mockRPS.mint).to.have.been.calledOnceWith(player1.address, bet);
    });

    describe('_deleteGame(...)', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let decryptedMove = 0;
        let move = 0;
        let bet = 3;
        let duration = 300;
        let timestamp = 0;
        let status = 0;
        let game0 = [
          gameId,
          player1.address,
          ethers.constants.AddressZero,
          bet,
          duration,
          timestamp,
          encryptedMove,
          decryptedMove,
          move,
          status,
        ];
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await expect(rockPaperScissors.connect(player1).quitGame(gameId))
          .to.emit(rockPaperScissors, 'GameDeleted')
          .withArgs(player1.address, gameId, game0);
      });

      it('should clear the game from the games list', async () => {
        let game0Id = await rockPaperScissors.gamesCreated();
        let game1Id = game0Id.add(1);
        let encryptedMove = utils.keccak256('0x01533d');
        let decryptedMove = 0;
        let move = 0;
        let bet = ethers.BigNumber.from(3);
        let duration = 300;
        let timestamp = ethers.BigNumber.from(0);
        let status = 0;
        let game1 = [
          game1Id,
          player1.address,
          ethers.constants.AddressZero,
          bet,
          duration,
          timestamp,
          encryptedMove,
          decryptedMove,
          move,
          status,
        ];
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player1).quitGame(game0Id);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });
  });

  describe('playGame(...)', function () {
    describe('checkGame(...)', function () {
      it('should revert if the games list is empty', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let move = 0;
        await expect(rockPaperScissors.playGame(gameId, move)).to.be.revertedWith('The games list is empty');
      });

      it('should revert if the game does not exist', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 0;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await expect(rockPaperScissors.playGame(gameId.add(1), move)).to.be.revertedWith('Game does not exist');
      });

      it('should revert if the game was deleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 0;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.quitGame(gameId);
        await expect(rockPaperScissors.playGame(gameId, move)).to.be.revertedWith('Game has been deleted');
      });

      it('should revert if the game already started', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.playGame(gameId, move);
        await expect(rockPaperScissors.playGame(gameId, move)).to.be.revertedWith('Game has already started');
      });
    });

    it('should revert if the submitted move is invalid', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 0;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.createGame(encryptedMove, bet, duration);
      await expect(rockPaperScissors.playGame(gameId, move)).to.be.revertedWith('Invalid move');
    });

    it('should call to burn RPS', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      mockRPS.burn.reset();
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      expect(mockRPS.burn).to.have.been.calledOnceWith(player2.address, bet);
    });

    it('should start the game', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 1;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let status = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      let timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game0 = [gameId, player1.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      let games = await rockPaperScissors.getGames();
      expect(games).to.eql([game0]);
    });

    it('should emit GameStarted', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await expect(rockPaperScissors.connect(player2).playGame(gameId, move))
        .to.emit(rockPaperScissors, 'GameStarted')
        .withArgs(player2.address, gameId, []);
    });

    it('should increment totalPlayerIds if the caller is a new player', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      for (let i = 0; i < 3; i++) {
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(i, move);
        let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
        expect(totalPlayerIds).to.equal(2);
      }
      for (let i = 3; i < 6; i++) {
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(deployer).playGame(i, move);
        let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
        expect(totalPlayerIds).to.equal(3);
      }
    });

    it('should assign an ID only to new players', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
      let player2Id = await rockPaperScissors.playerToId(player2.address);
      expect(player2Id).to.equal(totalPlayerIds);
      gameId = gameId.add(1);
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      expect(player2Id).to.equal(totalPlayerIds);
    });
  });

  describe('endGameAsPlayer1(...)', function () {
    describe('checkGame(...)', function () {
      it('should revert if the games list is empty', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let seed = '0x533d';
        await expect(rockPaperScissors.endGameAsPlayer1(gameId, seed)).to.be.revertedWith('The games list is empty');
      });

      it('should revert if the game does not exist', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await expect(rockPaperScissors.endGameAsPlayer1(gameId.add(1), seed)).to.be.revertedWith('Game does not exist');
      });

      it('should revert if the game was deleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.quitGame(gameId);
        await expect(rockPaperScissors.endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Game has been deleted');
      });

      it("should revert if the game didn't start", async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await expect(rockPaperScissors.endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Game has not started yet');
      });

      it('should revert if the game already ended', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.playGame(gameId, move);
        await rockPaperScissors.endGameAsPlayer1(gameId, seed);
        await expect(rockPaperScissors.endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Game has already ended');
      });

      it('should revert if caller is not player 1', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(gameId, move);
        await expect(rockPaperScissors.endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Player 1 is not you');
      });
    });

    describe('_decryptMove(...)', function () {
      it('should revert if decryption fails', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        let seed = '0x0000';
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.playGame(gameId, move);
        await expect(rockPaperScissors.endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Decryption failed');
      });
    });

    it('should end the game with a tie', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 1;
      let move = 1;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let status = 4;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      let timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game0 = [gameId, player1.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let games = await rockPaperScissors.getGames();
      expect(games).to.eql([game0]);
    });

    it('should emit GameEnded after a tie', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, []);
    });

    it('should call to mint RPS after a tie', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      mockRPS.mint.reset();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      expect(mockRPS.mint).to.have.been.calledOnceWith(player1.address, bet);
    });

    it('should end the game with player 1 as the winner', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 3;
      let bet = 3;
      let duration = 300;
      let status = 0;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      let endGameTx = await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let endGameTxR = await endGameTx.wait();
      for (let log of endGameTxR.events!) {
        if (log.event == 'GameEnded') {
          status = log.args!._game.status;
        }
      }
      expect(status).to.eql(2);
    });

    it('should emit GameEnded after player 1 wins', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 3;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, []);
    });

    it('should call to mint RPS after player 1 wins', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 3;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      mockRPS.mint.reset();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      expect(mockRPS.mint).to.have.been.calledOnceWith(player1.address, bet * 2);
    });

    describe('_deleteGame(...)', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 3;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(gameId, move);
        await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed))
          .to.emit(rockPaperScissors, 'GameDeleted')
          .withArgs(player1.address, gameId, []);
      });

      it('should clear the game from the games list', async () => {
        let game0Id = await rockPaperScissors.gamesCreated();
        let game1Id = game0Id.add(1);
        let encryptedMove = utils.keccak256('0x01533d');
        let decryptedMove = 0;
        let move = 0;
        let bet = ethers.BigNumber.from(3);
        let duration = 300;
        let timestamp = ethers.BigNumber.from(0);
        let status = 0;
        let game1 = [game1Id, player1.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, 0, status];
        move = 3;
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(game0Id, move);
        await rockPaperScissors.connect(player1).endGameAsPlayer1(game0Id, seed);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });

    it('should end the game with player 2 as the winner', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 1;
      let move = 2;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let status = 3;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      let timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game0 = [gameId, player1.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let games = await rockPaperScissors.getGames();
      expect(games).to.eql([game0]);
    });

    it('should emit GameEnded after player 2 wins', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 2;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, []);
    });
  });

  describe('endGameAsPlayer2(...)', function () {
    describe('checkGame(...)', function () {
      it('should revert if the games list is empty', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        await expect(rockPaperScissors.endGameAsPlayer2(gameId)).to.be.revertedWith('The games list is empty');
      });

      it('should revert if the game does not exist', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await expect(rockPaperScissors.endGameAsPlayer2(gameId.add(1))).to.be.revertedWith('Game does not exist');
      });

      it('should revert if the game was deleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.createGame(encryptedMove, bet, duration);
        await rockPaperScissors.quitGame(gameId);
        await expect(rockPaperScissors.endGameAsPlayer2(gameId)).to.be.revertedWith('Game has been deleted');
      });

      it('should revert if caller is not player 2', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await expect(rockPaperScissors.endGameAsPlayer2(gameId)).to.be.revertedWith('Player 2 is not you');
        await rockPaperScissors.connect(player2).playGame(gameId, move);
        await expect(rockPaperScissors.endGameAsPlayer2(gameId)).to.be.revertedWith('Player 2 is not you');
      });
    });

    it('should call to mint RPS in case of game tie', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      mockRPS.mint.reset();
      await rockPaperScissors.connect(player2).endGameAsPlayer2(gameId);
      expect(mockRPS.mint).to.have.been.calledOnceWith(player2.address, bet);
    });

    describe('_deleteGame(...) in case of game tie', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(gameId, move);
        await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
        await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
          .to.emit(rockPaperScissors, 'GameDeleted')
          .withArgs(player2.address, gameId, []);
      });

      it('should clear the game from the games list', async () => {
        let game0Id = await rockPaperScissors.gamesCreated();
        let game1Id = game0Id.add(1);
        let encryptedMove = utils.keccak256('0x01533d');
        let decryptedMove = 0;
        let move = 1;
        let bet = ethers.BigNumber.from(3);
        let duration = 300;
        let timestamp = ethers.BigNumber.from(0);
        let status = 0;
        let game1 = [
          game1Id,
          player1.address,
          ethers.constants.AddressZero,
          bet,
          duration,
          timestamp,
          encryptedMove,
          decryptedMove,
          move - move,
          status,
        ];
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(game0Id, move);
        await rockPaperScissors.connect(player1).endGameAsPlayer1(game0Id, seed);
        await rockPaperScissors.connect(player2).endGameAsPlayer2(game0Id);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });

    it('should revert if player 1 still has time to reveal his move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Player 1 still has time to reveal his move');
    });

    it('should end the game with player 2 as the winner in case of game win by unrevealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 2;
      let bet = 3;
      let duration = 300;
      let status = 0;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await evm.advanceTimeAndBlock(duration);
      let endGameTx = await rockPaperScissors.connect(player2).endGameAsPlayer2(gameId);
      let endGameTxR = await endGameTx.wait();
      for (let log of endGameTxR.events!) {
        if (log.event == 'GameEnded') {
          status = log.args!._game.status;
        }
      }
      expect(status).to.eql(3);
    });

    it('should emit GameEnded in case of game win by unrevealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await evm.advanceTimeAndBlock(duration);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player2.address, gameId, []);
    });

    it('should call to mint RPS in case of game win by unrevealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      mockRPS.mint.reset();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await evm.advanceTimeAndBlock(duration);
      await rockPaperScissors.connect(player2).endGameAsPlayer2(gameId);
      expect(mockRPS.mint).to.have.been.calledOnceWith(player2.address, bet * 2);
    });

    describe('_deleteGame(...) in case of game win by unrevealed move', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(gameId, move);
        await evm.advanceTimeAndBlock(duration);
        await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
          .to.emit(rockPaperScissors, 'GameDeleted')
          .withArgs(player2.address, gameId, []);
      });

      it('should clear the game from the games list', async () => {
        let game0Id = await rockPaperScissors.gamesCreated();
        let game1Id = game0Id.add(1);
        let encryptedMove = utils.keccak256('0x01533d');
        let decryptedMove = 0;
        let move = 1;
        let bet = ethers.BigNumber.from(3);
        let duration = 300;
        let timestamp = ethers.BigNumber.from(0);
        let status = 0;
        let game1 = [
          game1Id,
          player1.address,
          ethers.constants.AddressZero,
          bet,
          duration,
          timestamp,
          encryptedMove,
          decryptedMove,
          move - move,
          status,
        ];
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(game0Id, move);
        await evm.advanceTimeAndBlock(duration);
        await rockPaperScissors.connect(player2).endGameAsPlayer2(game0Id);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });

    it('should call to mint RPS in case of game win by revealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 2;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      mockRPS.mint.reset();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      await rockPaperScissors.connect(player2).endGameAsPlayer2(gameId);
      expect(mockRPS.mint).to.have.been.calledOnceWith(player2.address, bet * 2);
    });

    describe('_deleteGame(...) in case of game win by revealed move', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 2;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(gameId, move);
        await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
        await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
          .to.emit(rockPaperScissors, 'GameDeleted')
          .withArgs(player2.address, gameId, []);
      });

      it('should clear the game from the games list', async () => {
        let game0Id = await rockPaperScissors.gamesCreated();
        let game1Id = game0Id.add(1);
        let encryptedMove = utils.keccak256('0x01533d');
        let decryptedMove = 0;
        let move = 2;
        let bet = ethers.BigNumber.from(3);
        let duration = 300;
        let timestamp = ethers.BigNumber.from(0);
        let status = 0;
        let game1 = [
          game1Id,
          player1.address,
          ethers.constants.AddressZero,
          bet,
          duration,
          timestamp,
          encryptedMove,
          decryptedMove,
          move - move,
          status,
        ];
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
        await rockPaperScissors.connect(player2).playGame(game0Id, move);
        await rockPaperScissors.connect(player1).endGameAsPlayer1(game0Id, seed);
        await rockPaperScissors.connect(player2).endGameAsPlayer2(game0Id);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });
  });

  describe('withdrawEtherBalance(...)', function () {
    it('should revert if caller is not the owner', async () => {
      let _value = utils.parseEther('1');
      await expect(rockPaperScissors.connect(player1).withdrawEtherBalance(_value)).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should revert if ether in balance is insufficient', async () => {
      let _value = utils.parseEther('1');
      await expect(rockPaperScissors.connect(deployer).withdrawEtherBalance(_value)).to.be.revertedWith('Insufficient ether in balance');
    });

    it('should change ether balances', async () => {
      let _value = 100000;
      await deployer.sendTransaction({ to: rockPaperScissors.address, value: _value });
      await expect(() => rockPaperScissors.connect(deployer).withdrawEtherBalance(_value)).to.changeEtherBalances(
        [rockPaperScissors, deployer],
        [-_value, _value]
      );
    });

    it('should emit EtherWithdrawn', async () => {
      let _value = utils.parseEther('1');
      await deployer.sendTransaction({ to: rockPaperScissors.address, value: _value });
      await expect(rockPaperScissors.connect(deployer).withdrawEtherBalance(_value))
        .to.emit(rockPaperScissors, 'EtherWithdrawn')
        .withArgs(deployer.address, _value);
    });
  });

  describe('setRPSPrice(...)', function () {
    it('should revert if caller is not the owner', async () => {
      let _rpsPrice = 0;
      await expect(rockPaperScissors.connect(player1).setRPSPrice(_rpsPrice)).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should revert if the new price is zero', async () => {
      let _rpsPrice = 0;
      await expect(rockPaperScissors.connect(deployer).setRPSPrice(_rpsPrice)).to.be.revertedWith('Token price cannot be zero');
    });

    it('should emit RPSPriceChanged', async () => {
      let rpsPrice = await rockPaperScissors.rpsPrice();
      let _rpsPrice = 10000;
      await expect(rockPaperScissors.connect(deployer).setRPSPrice(_rpsPrice))
        .to.emit(rockPaperScissors, 'RPSPriceChanged')
        .withArgs(rpsPrice, _rpsPrice);
    });

    it('should update rpsPrice', async () => {
      let _rpsPrice = 10000;
      await rockPaperScissors.connect(deployer).setRPSPrice(_rpsPrice);
      let rpsPrice = await rockPaperScissors.rpsPrice();
      expect(rpsPrice).to.equal(_rpsPrice);
    });
  });

  describe('setRPSFee(...)', function () {
    it('should revert if caller is not the owner', async () => {
      let _rpsFee = 200;
      await expect(rockPaperScissors.connect(player1).setRPSFee(_rpsFee)).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should revert if the fee percentage is invalid', async () => {
      let _rpsFee = 200;
      await expect(rockPaperScissors.connect(deployer).setRPSFee(_rpsFee)).to.be.revertedWith('Invalid fee percentage');
    });

    it('should emit RPSFeeChanged', async () => {
      let rpsFee = await rockPaperScissors.rpsFee();
      let _rpsFee = 100;
      await expect(rockPaperScissors.connect(deployer).setRPSFee(_rpsFee)).to.emit(rockPaperScissors, 'RPSFeeChanged').withArgs(rpsFee, _rpsFee);
    });

    it('should update rpsFee', async () => {
      let _rpsFee = 100;
      await rockPaperScissors.connect(deployer).setRPSFee(_rpsFee);
      let rpsFee = await rockPaperScissors.rpsFee();
      expect(rpsFee).to.equal(_rpsFee);
    });
  });

  describe('getGames()', function () {
    it('should return the games list', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let timestamp = ethers.BigNumber.from(0);
      let status = 0;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let game0 = [gameId, player1.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      let game1 = [gameId, player2.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      status = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game2 = [gameId, player1.address, player1.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      decryptedMove = 1;
      status = 4;
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      let game3 = [gameId, player2.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      status = 3;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let game4 = [gameId, player1.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      let games = await rockPaperScissors.getGames();
      expect(games).to.eql([game0, game1, game2, game3, game4]);
    });
  });

  describe('getAvailableGames()', function () {
    it('should return the available games list', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let timestamp = ethers.BigNumber.from(0);
      let status = 0;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let game0 = [gameId, player1.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      let game1 = [gameId, player2.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).playGame(gameId, move);
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let availableGames = await rockPaperScissors.getAvailableGames();
      expect(availableGames).to.eql([game0, game1]);
    });
  });

  describe('getAvailableGamesByPlayer(...)', function () {
    it('should return the available games list, filtered by player', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let timestamp = ethers.BigNumber.from(0);
      let status = 0;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      let game0 = [gameId, player1.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      let game1 = [gameId, player2.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).playGame(gameId, move);
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let player1AvailableGames = await rockPaperScissors.getAvailableGamesByPlayer(player1.address);
      let player2AvailableGames = await rockPaperScissors.getAvailableGamesByPlayer(player2.address);
      expect(player1AvailableGames).to.eql([game0]);
      expect(player2AvailableGames).to.eql([game1]);
    });
  });

  describe('getAvailablePlayers()', function () {
    it('should return the available players list', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 0;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).playGame(gameId, move);
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let availablePlayers = await rockPaperScissors.getAvailablePlayers();
      expect(availablePlayers).to.eql([player1.address, player2.address]);
    });
  });

  describe('getActiveGames()', function () {
    it('should return the active games list', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let timestamp = ethers.BigNumber.from(0);
      let status = 0;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      let gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      status = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game2 = [gameId, player1.address, player1.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      decryptedMove = 1;
      status = 4;
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      let game3 = [gameId, player2.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      status = 3;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let game4 = [gameId, player1.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      let activeGames = await rockPaperScissors.getActiveGames();
      expect(activeGames).to.eql([game2, game3, game4]);
    });
  });

  describe('getActiveGamesByPlayer(...)', function () {
    it('should return the active games list, filtered by player', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let timestamp = ethers.BigNumber.from(0);
      let status = 0;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      let gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      status = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game2 = [gameId, player1.address, player1.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      decryptedMove = 1;
      status = 4;
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      let game3 = [gameId, player2.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      status = 3;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let game4 = [gameId, player1.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      let player1ActiveGames = await rockPaperScissors.getActiveGamesByPlayer(player1.address);
      let player2ActiveGames = await rockPaperScissors.getActiveGamesByPlayer(player2.address);
      expect(player1ActiveGames).to.eql([game2]);
      expect(player2ActiveGames).to.eql([game3, game4]);
    });
  });

  describe('getActivePlayers()', function () {
    it('should return the active players list', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 0;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player1).playGame(gameId, move);
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, bet, duration);
      await rockPaperScissors.connect(player2).playGame(gameId, move);
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      let activePlayers = await rockPaperScissors.getActivePlayers();
      expect(activePlayers).to.eql([player1.address, player2.address]);
    });
  });

  describe('getEtherBalance()', function () {
    it("should return contract's ether balance", async () => {
      let _value = utils.parseEther('1');
      await deployer.sendTransaction({ to: rockPaperScissors.address, value: _value });
      let etherBalance = await rockPaperScissors.getEtherBalance();
      expect(etherBalance).to.equal(await rockPaperScissors.provider.getBalance(rockPaperScissors.address));
    });
  });
});
