import { ethers } from 'hardhat';
import { utils } from 'ethers';
import { evm } from '@utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { RockPaperScissors, RockPaperScissors__factory } from '@typechained';
import { expect } from 'chai';
import { ripemd160 } from 'ethers/lib/utils';

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

  // misc
  let snapshotId: string;

  before(async () => {
    // forking mainnet
    await evm.reset({
      jsonRpcUrl: process.env.RPC_ROPSTEN,
      blockNumber: FORK_BLOCK_NUMBER,
    });

    // getting signers with ETH
    [, deployer, player1, player2] = await ethers.getSigners();

    // deploying contracts
    rockPaperScissorsFactory = (await ethers.getContractFactory('RockPaperScissors')) as RockPaperScissors__factory;
    rockPaperScissors = await rockPaperScissorsFactory.connect(deployer).deploy();

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

  describe('createGame(...)', function () {
    it('should increment gamesCreated', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      for (let i = 1; i <= 3; i++) {
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      let games = await rockPaperScissors.getGames();
      expect(games).to.eql([newGame]);
    });

    it('should emit GameCreated', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      await expect(rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet }))
        .to.emit(rockPaperScissors, 'GameCreated')
        .withArgs(player1.address, gameId, []);
    });

    it('should increment totalPlayerIds only if the caller is a new player', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      for (let i = 0; i < 3; i++) {
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
        expect(totalPlayerIds).to.equal(1);
      }
      for (let i = 3; i < 6; i++) {
        await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
        let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
        expect(totalPlayerIds).to.equal(2);
      }
    });

    it('should assign an ID only to new players', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
      let player1Id = await rockPaperScissors.playerToId(player1.address);
      expect(player1Id).to.equal(totalPlayerIds);
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
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
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await expect(rockPaperScissors.quitGame(gameId.add(1))).to.be.revertedWith('Game does not exist');
      });

      it('should revert if the game was deleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.quitGame(gameId);
        await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Game has been deleted');
      });

      it('should revert if the game already started', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.playGame(gameId, move, { value: bet });
        await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Game has already started');
      });

      it('should revert if caller is not player 1', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Player 1 is not you');
      });
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
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
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
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player1).quitGame(game0Id);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });

    it('should send the bet back', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await expect(() => rockPaperScissors.connect(player1).quitGame(gameId)).to.changeEtherBalances([rockPaperScissors, player1], [-bet, bet]);
    });

    it('should revert if sending the bet back fails', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(deployer).withdrawEtherBalance(bet);
      await expect(rockPaperScissors.connect(player1).quitGame(gameId)).to.be.revertedWith('Failed to send the bet back');
    });
  });

  describe('playGame(...)', function () {
    describe('checkGame(...)', function () {
      it('should revert if the games list is empty', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let move = 0;
        let bet = 3;
        await expect(rockPaperScissors.playGame(gameId, move, { value: bet })).to.be.revertedWith('The games list is empty');
      });

      it('should revert if the game does not exist', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 0;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await expect(rockPaperScissors.playGame(gameId.add(1), move, { value: bet })).to.be.revertedWith('Game does not exist');
      });

      it('should revert if the game was deleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 0;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.quitGame(gameId);
        await expect(rockPaperScissors.playGame(gameId, move, { value: bet })).to.be.revertedWith('Game has been deleted');
      });

      it('should revert if the game already started', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.playGame(gameId, move, { value: bet });
        await expect(rockPaperScissors.playGame(gameId, move, { value: bet })).to.be.revertedWith('Game has already started');
      });
    });

    it('should revert if ether sent is wrong', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 0;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
      await expect(rockPaperScissors.playGame(gameId, move, { value: 0 })).to.be.revertedWith('Wrong ether sent');
    });

    it('should revert if the submitted move is invalid', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 0;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
      await expect(rockPaperScissors.playGame(gameId, move, { value: bet })).to.be.revertedWith('Invalid move');
    });

    it('should start the game', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 1;
      let bet = ethers.BigNumber.from(3);
      let duration = 300;
      let status = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await expect(rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet }))
        .to.emit(rockPaperScissors, 'GameStarted')
        .withArgs(player2.address, gameId, []);
    });

    it('should increment totalPlayerIds only if the caller is a new player', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      for (let i = 0; i < 3; i++) {
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(i, move, { value: bet });
        let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
        expect(totalPlayerIds).to.equal(2);
      }
      for (let i = 3; i < 6; i++) {
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(deployer).playGame(i, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      let totalPlayerIds = await rockPaperScissors.totalPlayerIds();
      let player2Id = await rockPaperScissors.playerToId(player2.address);
      expect(player2Id).to.equal(totalPlayerIds);
      gameId = gameId.add(1);
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await expect(rockPaperScissors.endGameAsPlayer1(gameId.add(1), seed)).to.be.revertedWith('Game does not exist');
      });

      it('should revert if the game was deleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.quitGame(gameId);
        await expect(rockPaperScissors.endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Game has been deleted');
      });

      it("should revert if the game didn't start", async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await expect(rockPaperScissors.endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Game has not started yet');
      });

      it('should revert if the game already ended', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.playGame(gameId, move, { value: bet });
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
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, []);
    });

    it('should send the bet back after a tie', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await expect(() => rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed)).to.changeEtherBalances([rockPaperScissors, player1], [-bet, bet]);
    });

    it('should revert if sending the bet back fails after a tie', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(deployer).withdrawEtherBalance(bet * 2);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Failed to send the bet back');
    });

    it('should end the game with player 1 as the winner', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 3;
      let bet = 3;
      let duration = 300;
      let status = 0;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, []);
    });

    describe('_deleteGame(...) after player 1 wins', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 3;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(game0Id, move, { value: bet });
        await rockPaperScissors.connect(player1).endGameAsPlayer1(game0Id, seed);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });

    it('should send the reward after player 1 wins', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 3;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      let reward = bet * 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await expect(() => rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed)).to.changeEtherBalances([rockPaperScissors, player1], [-reward, reward]);
    });

    it('should revert if sending the reward fails after player 1 wins', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 3;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      let reward = bet * 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(deployer).withdrawEtherBalance(reward);
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed)).to.be.revertedWith('Failed to send the reward');
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await expect(rockPaperScissors.endGameAsPlayer2(gameId.add(1))).to.be.revertedWith('Game does not exist');
      });

      it('should revert if the game was deleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.quitGame(gameId);
        await expect(rockPaperScissors.endGameAsPlayer2(gameId)).to.be.revertedWith('Game has been deleted');
      });

      it('should revert if caller is not player 2', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await expect(rockPaperScissors.endGameAsPlayer2(gameId)).to.be.revertedWith('Player 2 is not you');
        await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
        await expect(rockPaperScissors.endGameAsPlayer2(gameId)).to.be.revertedWith('Player 2 is not you');
      });
    });

    describe('_deleteGame(...) in case of game tie', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(game0Id, move, { value: bet });
        await rockPaperScissors.connect(player1).endGameAsPlayer1(game0Id, seed);
        await rockPaperScissors.connect(player2).endGameAsPlayer2(game0Id);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });

    it('should send the bet back in case of game tie', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      await expect(() => rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.changeEtherBalances([rockPaperScissors, player2], [-bet, bet]);
    });

    it('should revert if sending the bet back fails in case of game tie', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      await rockPaperScissors.connect(deployer).withdrawEtherBalance(bet);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Failed to send the bet back');
    });

    it('should revert if player 1 still has time to reveal his move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Player 1 still has time to reveal his move');
    });

    it('should end the game with player 2 as the winner in case of game win by unrevealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 2;
      let bet = 3;
      let duration = 300;
      let status = 0;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await evm.advanceTimeAndBlock(duration);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player2.address, gameId, []);
    });

    describe('_deleteGame(...) in case of game win by unrevealed move', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 1;
        let bet = 3;
        let duration = 300;
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(game0Id, move, { value: bet });
        await evm.advanceTimeAndBlock(duration);
        await rockPaperScissors.connect(player2).endGameAsPlayer2(game0Id);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });

    it('should send the reward in case of game win by unrevealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let reward = bet * 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await evm.advanceTimeAndBlock(duration);
      await expect(() => rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.changeEtherBalances([rockPaperScissors, ], [-reward, reward]);
    });

    it('should revert if sending the reward fails in case of game win by unrevealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 1;
      let bet = 3;
      let duration = 300;
      let reward = bet * 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await evm.advanceTimeAndBlock(duration);
      await rockPaperScissors.connect(deployer).withdrawEtherBalance(reward);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Failed to send the reward');
    });

    describe('_deleteGame(...) in case of game win by revealed move', function () {
      it('should emit GameDeleted', async () => {
        let gameId = await rockPaperScissors.gamesCreated();
        let encryptedMove = utils.keccak256('0x01533d');
        let move = 2;
        let bet = 3;
        let duration = 300;
        let seed = '0x533d';
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
        await rockPaperScissors.connect(player2).playGame(game0Id, move, { value: bet });
        await rockPaperScissors.connect(player1).endGameAsPlayer1(game0Id, seed);
        await rockPaperScissors.connect(player2).endGameAsPlayer2(game0Id);
        let games = await rockPaperScissors.getGames();
        expect(games).to.eql([game1]);
      });
    });

    it('should send the reward in case of game win by revealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 2;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      let reward = bet * 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      await expect(() => rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.changeEtherBalances([rockPaperScissors, player2], [-reward, reward]);
    });

    it('should revert if sending the reward fails in case of game win by revealed move', async () => {
      let gameId = await rockPaperScissors.gamesCreated();
      let encryptedMove = utils.keccak256('0x01533d');
      let move = 2;
      let bet = 3;
      let duration = 300;
      let seed = '0x533d';
      let reward = bet * 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, seed);
      await rockPaperScissors.connect(deployer).withdrawEtherBalance(reward);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Failed to send the reward');
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      let game0 = [gameId, player1.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      let game1 = [gameId, player2.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      status = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).playGame(gameId, move, { value: bet });
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game2 = [gameId, player1.address, player1.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      decryptedMove = 1;
      status = 4;
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      let game3 = [gameId, player2.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      status = 3;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      let game0 = [gameId, player1.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      let game1 = [gameId, player2.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).playGame(gameId, move, { value: bet });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      let game0 = [gameId, player1.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      let game1 = [gameId, player2.address, ethers.constants.AddressZero, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).playGame(gameId, move, { value: bet });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).playGame(gameId, move, { value: bet });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      let gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      status = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).playGame(gameId, move, { value: bet });
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game2 = [gameId, player1.address, player1.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      decryptedMove = 1;
      status = 4;
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      let game3 = [gameId, player2.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      status = 3;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      let gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      status = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).playGame(gameId, move, { value: bet });
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      let game2 = [gameId, player1.address, player1.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      decryptedMove = 1;
      status = 4;
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      timestamp = ethers.BigNumber.from((await ethers.provider.getBlock('latest')).timestamp);
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      let game3 = [gameId, player2.address, player2.address, bet, duration, timestamp, encryptedMove, decryptedMove, move, status];
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      status = 3;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      gameId = await rockPaperScissors.gamesCreated();
      move = 1;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).playGame(gameId, move, { value: bet });
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player2).endGameAsPlayer1(gameId, seed);
      gameId = await rockPaperScissors.gamesCreated();
      move = 2;
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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

  /*describe('RockPaperScissors.sol', function () {
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

    it('createGame(bytes32 _encryptedMove, uint16 _duration)', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = 1;
      let duration = 300;
      let status = 0;
      let gameId = await rockPaperScissors.gamesCreated();
      await expect(rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet }))
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
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 0;
      let bet = 1;
      let duration = 300;
      let status = 0;
      await expect(rockPaperScissors.quitGame(0)).to.be.revertedWith('The games list is empty');
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
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
      await rockPaperScissors.connect(player1).createGame(encryptedMove, 500, { value: bet });
      await rockPaperScissors.connect(player1).createGame(encryptedMove, 200, { value: bet });
      await rockPaperScissors.connect(player1).playGame(2, 1, { value: bet });
      await expect(rockPaperScissors.quitGame(3)).to.be.revertedWith('Game does not exist');
      await expect(rockPaperScissors.quitGame(2)).to.be.revertedWith('Game has already started');
      await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Player 1 is not you');
      await expect(rockPaperScissors.connect(player1).quitGame(gameId))
        .to.emit(rockPaperScissors, 'GameDeleted')
        .withArgs(player1.address, gameId, []);
      expect(await rockPaperScissors.games(0)).to.not.eql(game0);
      await expect(rockPaperScissors.quitGame(gameId)).to.be.revertedWith('Game has been deleted');
      await expect(() => rockPaperScissors.connect(player1).quitGame(1)).to.changeEtherBalances([rockPaperScissors, player1], [-bet, bet]);
    });

    it('playGame(uint256 _gameId, Hand _move)', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 0;
      let move = 3;
      let bet = 1;
      let duration = 300;
      let status = 1;
      await expect(rockPaperScissors.playGame(0, 0)).to.be.revertedWith('The games list is empty');
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).createGame(encryptedMove, 500, { value: bet });
      await expect(rockPaperScissors.playGame(2, 0)).to.be.revertedWith('Game does not exist');
      await expect(rockPaperScissors.playGame(gameId, 0)).to.be.revertedWith('Wrong ether sent');
      await expect(rockPaperScissors.playGame(gameId, 0, { value: bet })).to.be.revertedWith('Invalid move');
      await expect(rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet }))
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
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 1;
      let bet = 1;
      let duration = 300;
      await expect(rockPaperScissors.endGameAsPlayer1(0, '0x533d')).to.be.revertedWith('The games list is empty');
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).createGame(encryptedMove, 500, { value: bet });
      await expect(rockPaperScissors.endGameAsPlayer1(2, '0x533d')).to.be.revertedWith('Game does not exist');
      await expect(rockPaperScissors.endGameAsPlayer1(gameId, '0x533d')).to.be.revertedWith('Game has not started yet');
      let moveSnapshot = await evm.snapshot.take();
      let move = 1;
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      let latestBlock = await ethers.provider.getBlock('latest');
      await rockPaperScissors.connect(player2).playGame(1, move, { value: bet });
      await expect(rockPaperScissors.endGameAsPlayer1(gameId, '0x533d')).to.be.revertedWith('Player 1 is not you');
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x01')).to.be.revertedWith('Decryption failed');
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d'))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, []);
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
      await expect(() => rockPaperScissors.connect(player1).endGameAsPlayer1(1, '0x533d')).to.changeEtherBalances(
        [rockPaperScissors, player1],
        [-bet, bet]
      );
      await evm.snapshot.revert(moveSnapshot);
      move = 2;
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player2).playGame(1, move, { value: bet });
      await expect(rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d'))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player1.address, gameId, [])
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
      await expect(() => rockPaperScissors.connect(player1).endGameAsPlayer1(1, '0x533d')).to.changeEtherBalances(
        [rockPaperScissors, player1],
        [-bet * 2, bet * 2]
      );
    });

    it('endGameAsPlayer2(uint256 _gameId)', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 1;
      let bet = 1;
      let duration = 300;
      await expect(rockPaperScissors.endGameAsPlayer2(0)).to.be.revertedWith('The games list is empty');
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player1).createGame(encryptedMove, 200, { value: bet });
      await expect(rockPaperScissors.endGameAsPlayer2(2)).to.be.revertedWith('Game does not exist');
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Player 2 is not you');
      let moveSnapshot = await evm.snapshot.take();
      let move = 1;
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      let latestBlock = await ethers.provider.getBlock('latest');
      await rockPaperScissors.connect(player2).playGame(1, move, { value: bet });
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d');
      await rockPaperScissors.connect(player1).endGameAsPlayer1(1, '0x533d');
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
        .to.emit(rockPaperScissors, 'GameDeleted')
        .withArgs(player2.address, gameId, []);
      expect(await rockPaperScissors.games(0)).to.not.eql(game0);
      await expect(() => rockPaperScissors.connect(player2).endGameAsPlayer2(1)).to.changeEtherBalances(
        [rockPaperScissors, player2],
        [-bet, bet]
      );
      await evm.snapshot.revert(moveSnapshot);
      move = 2;
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player2).playGame(1, move, { value: bet });
      await rockPaperScissors.connect(player1).endGameAsPlayer1(gameId, '0x533d');
      await rockPaperScissors.connect(player1).endGameAsPlayer1(1, '0x533d');
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
        .to.emit(rockPaperScissors, 'GameDeleted')
        .withArgs(player2.address, gameId, []);
      expect(await rockPaperScissors.games(0)).to.not.eql(game0);
      await expect(() => rockPaperScissors.connect(player2).endGameAsPlayer2(1)).to.changeEtherBalances(
        [rockPaperScissors, player2],
        [-bet * 2, bet * 2]
      );
      await evm.snapshot.revert(moveSnapshot);
      move = 3;
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
      await rockPaperScissors.connect(player2).playGame(1, move, { value: bet });
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId)).to.be.revertedWith('Player 1 still has time to reveal his move');
      await evm.advanceToTimeAndBlock(latestBlock.timestamp - 1 + duration);
      await expect(rockPaperScissors.connect(player2).endGameAsPlayer2(gameId))
        .to.emit(rockPaperScissors, 'GameEnded')
        .withArgs(player2.address, gameId, [])
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
      await expect(() => rockPaperScissors.connect(player2).endGameAsPlayer2(1)).to.changeEtherBalances(
        [rockPaperScissors, player2],
        [-bet * 2, bet * 2]
      );
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

    it('Getters (games and players)', async () => {
      let encryptedMove = utils.keccak256('0x01533d');
      let decryptedMove = 1;
      let bet = 1;
      let duration = 300;
      let gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      let move = 1;
      await rockPaperScissors.connect(player1).playGame(gameId, move, { value: bet });
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
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
      move = 2;
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
      await rockPaperScissors.connect(player2).playGame(gameId, move, { value: bet });
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
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player2).createGame(encryptedMove, duration, { value: bet });
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
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
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
      gameId = await rockPaperScissors.gamesCreated();
      await rockPaperScissors.connect(player1).createGame(encryptedMove, duration, { value: bet });
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
  });*/
