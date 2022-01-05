import { ethers } from 'hardhat';
import { utils } from 'ethers';
import { evm } from '@utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { RockPaperScissors, RockPaperScissors__factory } from '@typechained';
import { expect } from 'chai';

const FORK_BLOCK_NUMBER = 11298165;

describe('RockPaperScissors', function () {
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

  describe('RockPaperScissors.sol', function () {
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
  });
});
